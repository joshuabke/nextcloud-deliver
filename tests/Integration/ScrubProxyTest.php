<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The Scrub Proxy (#169): a tiny rendition of every video Version for hover
 * previews, made by ffmpeg or handed in by the browser where there is none.
 * ffmpeg makes the fixtures, so this is skipped where there is no ffmpeg.
 */
class ScrubProxyTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

	/** Two seconds of H.264/AAC at 25 fps, 640 wide: it plays as it is, so it gets no Proxy */
	private const CUT = '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest -f mp4';
	/** Its Scrub Proxy as the browser makes it */
	private const SCRUB = '-f lavfi -i testsrc=size=320x180:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -b:v 250k -f mp4';

	protected function setUp(): void {
		if ($this->shell('ffmpeg -version')[0] !== 0) {
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
		$this->fixture = sys_get_temp_dir() . '/deliver-scrub-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => '']);
		$this->nc->deleteProject($this->projectId);
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	/** @return array{0: int, 1: string} exit code and output */
	private function shell(string $command): array {
		$output = [];
		$code = 0;
		exec($command . ' 2>&1', $output, $code);
		return [$code, implode("\n", $output)];
	}

	private function make(string $args, string $file): void {
		[$code, $output] = $this->shell('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($file));
		self::assertSame(0, $code, $output);
	}

	private function drainQueue(): void {
		[$code, $output] = $this->shell('php /var/www/html/occ deliver:worker --once');
		self::assertSame(0, $code, $output);
	}

	/** Runs PHP inside this Nextcloud, for what no API does */
	private function inNextcloud(string $code): string {
		[$status, $output] = $this->shell('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; ' . $code));
		self::assertSame(0, $status, $output);
		return $output;
	}

	/** @return array<string, mixed> the Version as the Review view sees it */
	private function version(int $versionId): array {
		$shown = $this->nc->ocs('GET', "/versions/$versionId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['versions'][0];
	}

	/** @return array<string, mixed> the newest Version of the Asset of this name, as its card has it */
	private function card(string $name): array {
		foreach ($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'] as $asset) {
			if ($asset['name'] === $name) {
				return $asset['versions'][0];
			}
		}
		self::fail("No Asset $name");
	}

	/** @return int the Version of the cut, uploaded under this name */
	private function upload(string $name = 'cut.mp4'): int {
		$this->make(self::CUT, $this->fixture);
		$this->nc->put("{$this->root}/$name", (string)file_get_contents($this->fixture));
		return $this->card(pathinfo($name, PATHINFO_FILENAME))['id'];
	}

	public function testFfmpegMakesOneForEveryVideoVersionAtThreeHundredTwentyWide(): void {
		$id = $this->upload();
		$this->drainQueue();
		$version = $this->version($id);
		self::assertSame('none', $version['derived']['proxy']['state'], 'it plays as it is');
		self::assertSame('ready', $version['derived']['scrub']['state'], (string)$version['derived']['error']);
		self::assertSame($version['derived']['scrub']['url'], $this->card('cut')['scrubUrl']);

		$scrub = $this->nc->request('GET', $version['derived']['scrub']['url']);
		self::assertSame(200, $scrub['status']);
		$copy = $this->fixture . '-scrub.mp4';
		file_put_contents($copy, $scrub['body']);
		[, $streams] = $this->shell('ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames -of csv=p=0 ' . escapeshellarg($copy));
		[, $keyframes] = $this->shell('ffprobe -v error -select_streams v:0 -skip_frame nokey -show_entries frame=pts_time -of default=nw=1:nk=1 ' . escapeshellarg($copy));
		@unlink($copy);
		self::assertSame('h264,video,320,180,25/1,50', trim($streams), 'every Frame at the source rate, 320 wide and no sound');
		self::assertSame(['0.000000', '1.000000'], array_values(array_filter(explode("\n", trim($keyframes)))), 'a keyframe a second');

		self::assertSame(200, $this->nc->ocs('POST', "/versions/$id/regenerate")['status']);
		self::assertSame('none', $this->version($id)['derived']['scrub']['state'], 'regenerating deletes it');
		self::assertNull($this->card('cut')['scrubUrl']);
		self::assertSame(404, $this->nc->request('GET', $version['derived']['scrub']['url'])['status']);
		$this->drainQueue();
		self::assertSame('ready', $this->version($id)['derived']['scrub']['state'], 'and makes it again');
	}

	public function testOlderVersionsGetOneFromTheHourlyJobAfterAllOtherWork(): void {
		$old = $this->upload('old.mp4');
		$this->drainQueue();
		// As a Version from before Scrub Proxies were
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_versions")->set("scrub_state", $q->createNamedParameter("none"))->where($q->expr()->eq("id", $q->createNamedParameter(' . $old . ')))->executeStatement();');
		$this->nc->put("{$this->root}/new.mp4", (string)file_get_contents($this->fixture));

		$hourly = '\\OCP\\Server::get(\\OCA\\Deliver\\BackgroundJob\\ScanProjects::class)->start(\\OCP\\Server::get(\\OCP\\BackgroundJob\\IJobList::class));';
		$this->inNextcloud($hourly);
		self::assertSame('queued', $this->version($old)['derived']['scrub']['state']);
		$order = $this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10) as $job) { echo $job->getKind(), " "; }');
		self::assertSame('probe scrub', trim($order), 'the new upload goes first, though queued later');

		$this->drainQueue();
		self::assertSame('ready', $this->version($old)['derived']['scrub']['state']);
		self::assertSame('ready', $this->version($this->card('new')['id'])['derived']['scrub']['state']);

		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe'])['status']);
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_versions")->set("scrub_state", $q->createNamedParameter("none"))->where($q->expr()->eq("id", $q->createNamedParameter(' . $old . ')))->executeStatement();');
		$this->inNextcloud($hourly);
		self::assertSame('none', $this->version($old)['derived']['scrub']['state'], 'without ffmpeg only new uploads get one, from the browser');
	}

	/** Sets the Scrub Proxy state of Versions as the database has it, for Versions from before Scrub Proxies were */
	private function scrubState(string $state, int ...$ids): void {
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_versions")->set("scrub_state", $q->createNamedParameter("' . $state . '"))->where($q->expr()->in("id", $q->createNamedParameter([' . implode(',', $ids) . '], \\OCP\\DB\\QueryBuilder\\IQueryBuilder::PARAM_INT_ARRAY)))->executeStatement();');
	}

	/** @return string the Versions of the queued Scrub Proxies, in the order they run */
	private function queuedScrubs(): string {
		return trim($this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10, "scrub") as $job) { echo $job->getVersionId(), " "; }'));
	}

	private function backfill(int $limit): int {
		return (int)$this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\Service\\DerivedMedia::class)->queueMissingScrubs(' . $limit . ');');
	}

	public function testTheBackfillTakesTheNewestWithoutAFailedOneAndWaitsForTheLastBatch(): void {
		$a = $this->upload('a.mp4');
		$b = $this->upload('b.mp4');
		$c = $this->upload('c.mp4');
		$this->drainQueue();
		$this->scrubState('none', $a, $b);
		$this->scrubState('failed', $c);

		self::assertSame(1, $this->backfill(1));
		self::assertSame("$b", $this->queuedScrubs(), 'the newest, past the failed one');
		self::assertSame(0, $this->backfill(1), 'nothing more while one waits');
		self::assertSame('none', $this->version($a)['derived']['scrub']['state']);
		self::assertSame('failed', $this->version($c)['derived']['scrub']['state']);

		$this->drainQueue();
		$this->scrubState('none', $b);
		self::assertSame(2, $this->backfill(5), 'once it is done, the next ones; the failed one stays out');
		$d = $this->upload('d.mp4');
		$this->inNextcloud('\\OCP\\Server::get(\\OCA\\Deliver\\Service\\JobRunner::class)->runNext("test");');
		self::assertSame("$d $b $a", $this->queuedScrubs(), 'a fresh upload\'s before the older ones');
	}

	public function testAScrubProxyHoldsUpNoOtherWork(): void {
		$old = $this->upload('old.mp4');
		$this->drainQueue();
		// A long Scrub Proxy of an old master takes the one job at a time there is
		$this->inNextcloud('$job = new \\OCA\\Deliver\\Db\\Job(); $job->setKind("scrub"); $job->setVersionId(' . $old . '); $job->setState("running"); $job->setClaimedBy("other"); $job->setCreatedAt(time()); $job->setStartedAt(time()); \\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->insert($job);');
		try {
			$new = $this->upload('new.mp4');
			$this->drainQueue();
			$version = $this->version($new);
			self::assertTrue($version['playable'], 'the new upload was read meanwhile');
			self::assertSame('ready', $version['derived']['thumbs']['state']);
			self::assertSame('ready', $version['derived']['waveform']['state']);
			self::assertSame('queued', $version['derived']['scrub']['state'], 'its Scrub Proxy waits for the slot');
		} finally {
			$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->delete("deliver_jobs")->where($q->expr()->eq("claimed_by", $q->createNamedParameter("other")))->executeStatement();');
		}
	}

	public function testAReviewerScrubsThroughItAlsoOnALinkWithoutDownloads(): void {
		$id = $this->upload();
		$this->drainQueue();
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		self::assertSame(200, $this->nc->ocs('PUT', "/links/{$link['id']}", ['canDownload' => false])['status']);
		$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);

		$listed = $visitor->call('GET', '/api/assets')['data'][0];
		self::assertNull($listed['downloadUrl']);
		self::assertStringEndsWith("/media/$id/scrub", (string)$listed['scrubUrl']);
		self::assertStringEndsWith("/media/$id/scrub", (string)$visitor->call('GET', "/api/context?versionId=$id")['data']['versions'][0]['derived']['scrub']['url']);
		$served = $visitor->raw("/media/$id/scrub");
		self::assertSame(200, $served['status']);
		self::assertStringContainsString('ftyp', substr($served['body'], 0, 12));
	}

	/** @return array{0: int, 1: string} file id and path of a Scrub Proxy made here, uploaded next to the Version's file */
	private function scrubFrom(string $args): array {
		$file = $this->fixture . '-hand.mp4';
		$this->make($args, $file);
		$path = "{$this->root}/.deliver-scrub-" . bin2hex(random_bytes(4));
		$this->nc->put($path, (string)file_get_contents($file));
		unlink($file);
		return [$this->nc->fileId($path), $path];
	}

	private function withoutFfmpeg(): void {
		$gone = $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe']);
		self::assertSame(200, $gone['status'], json_encode($gone['data']));
	}

	public function testWithoutFfmpegTheBrowserHandsItIn(): void {
		$this->withoutFfmpeg();
		$id = $this->upload();
		$this->drainQueue();
		self::assertSame('none', $this->version($id)['derived']['scrub']['state'], 'nothing on the server makes one');

		[$upload, $path] = $this->scrubFrom(self::SCRUB);
		$given = $this->nc->ocs('POST', "/versions/$id/scrub", ['fileId' => $upload]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame(404, $this->nc->davStatus('PROPFIND', $path), 'the upload is gone');
		self::assertCount(1, $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], 'and never became an Asset');
		$version = $this->version($id);
		self::assertSame('ready', $version['derived']['scrub']['state']);
		self::assertStringContainsString('ftyp', substr($this->nc->request('GET', $version['derived']['scrub']['url'])['body'], 0, 12));
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/scrub", ['fileId' => $this->scrubFrom(self::SCRUB)[0]])['status'], 'once is enough');
	}

	public function testWithFfmpegTheServerMakesItItself(): void {
		$id = $this->upload();
		[$upload, $path] = $this->scrubFrom(self::SCRUB);
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/scrub", ['fileId' => $upload])['status']);
		self::assertSame(404, $this->nc->davStatus('PROPFIND', $path), 'the upload is gone all the same');
	}

	/** @return array<string, array{string, string}> */
	public static function wrongScrubs(): array {
		return [
			'wider than 320' => ['-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p -b:v 250k -f mp4', 'wider than 320'],
			'a Frame short' => ['-f lavfi -i testsrc=size=320x180:rate=25:duration=1.96 -c:v libx264 -pix_fmt yuv420p -b:v 250k -f mp4', 'other Frames'],
			'another frame rate' => ['-f lavfi -i testsrc=size=320x180:rate=50:duration=1 -c:v libx264 -pix_fmt yuv420p -r 50 -f mp4', 'another frame rate'],
			'no H.264' => ['-f lavfi -i testsrc=size=320x180:rate=25:duration=2 -c:v mpeg4 -f mp4', 'no H.264 MP4'],
			'too heavy' => ['-f lavfi -i "testsrc=size=320x180:rate=25:duration=2,noise=alls=60:allf=t" -c:v libx264 -pix_fmt yuv420p -crf 5 -f mp4', 'not below 0.5 Mbit/s'],
		];
	}

	#[DataProvider('wrongScrubs')]
	public function testAScrubProxyThatDoesNotFitIsRefused(string $args, string $why): void {
		$this->withoutFfmpeg();
		$id = $this->upload();
		$this->drainQueue();

		[$upload, $path] = $this->scrubFrom($args);
		$refused = $this->nc->ocs('POST', "/versions/$id/scrub", ['fileId' => $upload]);
		self::assertSame(400, $refused['status'], json_encode($refused['data']));
		self::assertStringContainsString($why, (string)$refused['data']['message']);
		self::assertSame(404, $this->nc->davStatus('PROPFIND', $path), 'the upload is gone all the same');
		self::assertSame('none', $this->version($id)['derived']['scrub']['state'], 'so the browser may try again');
	}
}
