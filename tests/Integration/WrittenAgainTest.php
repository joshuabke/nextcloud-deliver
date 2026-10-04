<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * A file written again in place keeps its file id, Version and Comments, and
 * Deliver reads it again as on intake: what was read from the old content and
 * its derived media go and are made again (spec: Delivering again). ffmpeg
 * makes the fixtures and reads them.
 */
class WrittenAgainTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

	protected function setUp(): void {
		exec('ffmpeg -version 2>&1', $output, $code);
		if ($code !== 0) {
			self::markTestSkipped('no ffmpeg in this container');
		}
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->fixture = sys_get_temp_dir() . '/deliver-again-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	/** Makes the fixture with ffmpeg and writes it to the path, new or again */
	private function write(string $name, string $args): void {
		exec('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$this->nc->put("{$this->root}/$name", (string)file_get_contents($this->fixture));
	}

	private function drainQueue(): void {
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
	}

	private function versionId(): int {
		return $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
	}

	/** @return array<string, mixed> the Version as the Review view sees it */
	private function version(int $versionId): array {
		$shown = $this->nc->ocs('GET', "/versions/$versionId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['versions'][0];
	}

	/** @return list<array<string, mixed>>|int what a query on Nextcloud's database finds, or how many rows a statement changed */
	private function db(string $sql, array $params = []): array|int {
		$query = <<<'PHP'
			require '/var/www/html/lib/base.php';
			$db = \OCP\Server::get(\OCP\IDBConnection::class);
			echo json_encode(str_starts_with($argv[1], 'SELECT') ? $db->executeQuery($argv[1], json_decode($argv[2]))->fetchAll() : $db->executeStatement($argv[1], json_decode($argv[2])));
			PHP;
		exec('php -r ' . escapeshellarg($query) . ' ' . escapeshellarg($sql) . ' ' . escapeshellarg(json_encode($params)), $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		return json_decode(implode("\n", $output), true);
	}

	public function testAMixWrittenAgainIsReadAgainAndDropsAWaveformHandedIn(): void {
		$this->write('mix.wav', '-f lavfi -i sine=frequency=440:duration=2 -ar 48000 -write_bext 1 -metadata time_reference=172800000 -f wav');
		$mix = $this->versionId();
		$this->drainQueue();
		self::assertSame(3600000, $this->version($mix)['startFrame']);
		self::assertSame(201, $this->nc->ocs('POST', "/versions/$mix/comments", ['inFrame' => 500, 'body' => 'louder here'])['status']);

		$this->write('mix.wav', '-f lavfi -i sine=frequency=880:duration=1 -f wav');
		self::assertSame($mix, $this->versionId(), 'the same file id, so the same Version');
		$written = $this->version($mix);
		self::assertSame([0, null, 'none'], [$written['startFrame'], $written['durationFrames'], $written['derived']['waveform']['state']], 'nothing of the old audio stands over the new');
		self::assertSame(['louder here'], array_column($this->nc->ocs('GET', "/versions/$mix/comments")['data']['comments'], 'body'), 'the Comments stay');

		// The delivering tool hands in its peaks right after the upload, and delivers again before the probe ran
		$handIn = fn () => $this->nc->ocs('POST', "/versions/$mix/waveform", ['peaks' => [0.1, 0.5, 1], 'durationFrames' => 3000]);
		self::assertSame(200, $handIn()['status']);
		$this->write('mix.wav', '-f lavfi -i sine=frequency=660:duration=2 -f wav');
		$again = $this->version($mix);
		self::assertSame([null, 'none'], [$again['durationFrames'], $again['derived']['waveform']['state']], 'a Waveform handed in for the old content goes with it');
		self::assertSame(200, $handIn()['status'], 'and the next one is taken');

		$this->drainQueue();
		$read = $this->version($mix);
		self::assertSame([0, 2000, ['num' => 1000, 'den' => 1], 'ready'], [$read['startFrame'], $read['durationFrames'], $read['fps'], $read['derived']['waveform']['state']], 'read again from the file');
	}

	public function testACutWrittenAgainGetsItsDerivedMediaMadeAgain(): void {
		$this->write('cut.mov', '-f lavfi -i testsrc=size=320x180:rate=24000/1001:duration=1 -f lavfi -i sine=duration=1 -c:v prores_ks -profile:v 0 -c:a pcm_s16le -f mov');
		$cut = $this->versionId();
		$this->drainQueue();
		self::assertSame('ready', $this->version($cut)['derived']['proxy']['state']);

		$this->write('cut.mov', '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v prores_ks -profile:v 0 -f mov');
		$written = $this->version($cut);
		self::assertSame(
			[null, null, null, 'none', 'none', 'none'],
			[$written['durationFrames'], $written['width'], $written['playable'], $written['derived']['proxy']['state'], $written['derived']['thumbs']['state'], $written['derived']['waveform']['state']],
			'nothing of the old file stands',
		);
		self::assertCount(1, $this->db('SELECT id FROM *PREFIX*deliver_jobs WHERE version_id = ? AND kind = ?', [$cut, 'probe']), 'read again as on intake');

		$this->drainQueue();
		$read = $this->version($cut);
		self::assertSame(
			[['num' => 25, 'den' => 1], 50, 640, 'ready', 'ready', 'none'],
			[$read['fps'], $read['durationFrames'], $read['width'], $read['derived']['proxy']['state'], $read['derived']['thumbs']['state'], $read['derived']['waveform']['state']],
			(string)$read['derived']['error'],
		);

		// Restoring the older file version in Files writes it in place too
		$listed = $this->nc->request('PROPFIND', "/remote.php/dav/versions/{$this->nc->user}/versions/" . $this->nc->fileId("{$this->root}/cut.mov"), null, ['Depth: 1']);
		preg_match_all('#<d:href>([^<]+/\d+)</d:href>#', $listed['body'], $hrefs);
		self::assertSame(201, $this->nc->request('MOVE', min($hrefs[1]), null, ["Destination: /remote.php/dav/versions/{$this->nc->user}/restore/target"])['status']);
		self::assertNull($this->version($cut)['durationFrames']);
		$this->drainQueue();
		self::assertSame([['num' => 24000, 'den' => 1001], 'ready'], [$this->version($cut)['fps'], $this->version($cut)['derived']['waveform']['state']]);
	}

	public function testANewFileIsQueuedOnce(): void {
		// A job already in the table tells which id the next one gets
		$this->db('INSERT INTO *PREFIX*deliver_jobs (kind, version_id, created_at) VALUES (?, 0, 0)', ['probe']);
		$marker = (int)$this->db('SELECT MAX(id) AS id FROM *PREFIX*deliver_jobs')[0]['id'];
		try {
			$this->write('new.wav', '-f lavfi -i sine=duration=1 -f wav');
			$jobs = $this->db('SELECT id FROM *PREFIX*deliver_jobs WHERE version_id = ?', [$this->versionId()]);
		} finally {
			$this->db('DELETE FROM *PREFIX*deliver_jobs WHERE id = ?', [$marker]);
		}
		self::assertSame([$marker + 1], array_map('intval', array_column($jobs, 'id')), 'the write that comes with creating a file is no second delivery');
	}
}
