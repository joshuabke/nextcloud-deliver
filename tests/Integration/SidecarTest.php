<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * A delivering tool hands Deliver what it knows of a file it rendered:
 * start on the session's timeline, duration and Waveform (ADR 0012). It
 * stands over any probe, so a server without ffmpeg works fully.
 */
class SidecarTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;

	protected function setUp(): void {
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$this->nc->put("{$this->root}/mix.mp3", 'not really audio');
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->projectId = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)])['data']['id'];
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
	}

	/** @return array<string, int> Asset name → Version id */
	private function versions(): array {
		$assets = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		return array_combine(array_column($assets, 'name'), array_map(static fn (array $asset) => $asset['versions'][0]['id'], $assets));
	}

	public function testTheSidecarStandsOverTheProbe(): void {
		$mix = $this->versions()['mix'];
		$given = $this->nc->ocs('PUT', "/versions/$mix/sidecar", [
			'start' => 252.35,
			'duration' => 3.2,
			'waveform' => ['rate' => 10, 'peaks' => array_fill(0, 32, 0.5)],
		]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame([252350, 3200, ['num' => 1000, 'den' => 1], true], [$given['data']['startFrame'], $given['data']['durationFrames'], $given['data']['fps'], $given['data']['audioOnly']], 'milliseconds on the session timeline (ADR 0007)');
		self::assertSame('ready', $given['data']['derived']['waveform']['state']);

		$waveform = json_decode($this->nc->request('GET', (string)$given['data']['derived']['waveform']['url'])['body'], true);
		self::assertSame([10, 32], [$waveform['rate'], count($waveform['peaks'])], 'stored as given, at its own rate');

		exec('php /var/www/html/occ deliver:worker --once 2>&1');
		$after = $this->nc->ocs('GET', "/versions/$mix")['data']['versions'][0];
		self::assertSame([252350, 'ready'], [$after['startFrame'], $after['derived']['waveform']['state']], 'no probe overrides it, and nothing fails without ffmpeg');

		$regenerated = $this->nc->ocs('POST', "/versions/$mix/regenerate");
		self::assertSame('ready', $regenerated['data']['derived']['waveform']['state'], 'what only the tool knew is not thrown away');

		// A probe and a Waveform job queued just before the Sidecar arrived, as a worker would find them
		$queue = <<<'PHP'
			require '/var/www/html/lib/base.php';
			$db = \OCP\Server::get(\OCP\IDBConnection::class);
			foreach (['probe', 'waveform'] as $kind) {
				$db->executeStatement('INSERT INTO *PREFIX*deliver_jobs (kind, version_id, created_at) VALUES (?, ?, 0)', [$kind, $argv[1]]);
			}
			$db->executeStatement('UPDATE *PREFIX*deliver_versions SET waveform_state = ? WHERE id = ?', ['queued', $argv[1]]);
			PHP;
		exec('php -r ' . escapeshellarg($queue) . " $mix 2>&1", $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		exec('php /var/www/html/occ deliver:worker --once 2>&1');
		$after = $this->nc->ocs('GET', "/versions/$mix")['data']['versions'][0];
		self::assertSame(
			[252350, ['num' => 1000, 'den' => 1], 'ready', null],
			[$after['startFrame'], $after['fps'], $after['derived']['waveform']['state'], $after['derived']['error']],
			'a job from before the Sidecar overwrites nothing and fails for nothing',
		);
		$waveform = json_decode($this->nc->request('GET', (string)$after['derived']['waveform']['url'])['body'], true);
		self::assertSame([10, 32], [$waveform['rate'], count($waveform['peaks'])], 'still the Sidecar\'s Waveform');
	}

	public function testTheSidecarKeepsItsLimits(): void {
		['mix' => $mix, 'cut' => $cut] = $this->versions();
		$put = fn (int $id, array $fields) => $this->nc->ocs('PUT', "/versions/$id/sidecar", $fields + ['start' => 0, 'duration' => 2, 'waveform' => ['rate' => 10, 'peaks' => [0.1, 0.2]]])['status'];
		self::assertSame(400, $put($mix, ['waveform' => ['rate' => 101, 'peaks' => [0.1]]]), 'at most 100 peaks a second');
		self::assertSame(400, $put($mix, ['waveform' => ['rate' => 1, 'peaks' => array_fill(0, 10, 0.1)]]), 'no more peaks than the duration holds');
		self::assertSame(400, $put($mix, ['waveform' => ['rate' => 10, 'peaks' => [1.5]]]), 'peaks run from 0 to 1');
		self::assertSame(400, $put($mix, ['duration' => 0]));
		self::assertSame(400, $put($mix, ['duration' => 86401]), 'at most 24 hours');
		self::assertSame(400, $put($mix, ['duration' => 86400, 'waveform' => ['rate' => 100, 'peaks' => array_fill(0, 1000001, 0)]]), 'at most a million peaks');
		self::assertSame(400, $put($cut, []), 'audio files only');
		self::assertSame(200, $put($mix, []));
	}
}
