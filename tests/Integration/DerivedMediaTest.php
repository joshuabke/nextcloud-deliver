<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Derived media from real ffmpeg runs (ADR 0003): the Proxy keeps the source
 * frame rate exactly, and everything is served with byte ranges. Skipped where
 * there is no ffmpeg, which is a supported install.
 */
class DerivedMediaTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

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
		$this->fixture = sys_get_temp_dir() . '/deliver-fixture-' . bin2hex(random_bytes(4)) . '.mov';
	}

	protected function tearDown(): void {
		$this->resumeIdle();
		$this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'none', 'hwDevice' => '', 'extraArgs' => '', 'maxHeight' => 1080, 'maxBitrate' => 20]);
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

	/** A second of ProRes at 24000/1001: no browser plays it, and the frame rate is not a whole number */
	private function makeFixture(): void {
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=24000/1001:duration=1 '
			. '-f lavfi -i sine=frequency=440:duration=1 -c:v prores_ks -profile:v 0 -c:a pcm_s16le %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
	}

	private function drainQueue(): void {
		[$code, $output] = $this->shell('php /var/www/html/occ deliver:worker --once');
		self::assertSame(0, $code, $output);
	}

	/** @return array<string, mixed> the Version as the Review view sees it */
	private function version(int $versionId): array {
		$shown = $this->nc->ocs('GET', "/versions/$versionId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['versions'][0];
	}

	public function testAProxyKeepsTheSourceFrameRateAndIsServedInRanges(): void {
		$this->makeFixture();
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));

		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		$versionId = $shown['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertSame(['num' => 24000, 'den' => 1001], $version['fps'], 'ffprobe keeps the frame rate a fraction');
		self::assertFalse($version['playable'], 'no browser plays ProRes, so the Proxy is the only way to watch it');
		self::assertSame('ready', $version['derived']['proxy']['state'], $version['derived']['error'] ?? '');
		self::assertSame('ready', $version['derived']['thumbs']['state']);
		self::assertSame('ready', $version['derived']['waveform']['state']);

		$proxy = $this->nc->request('GET', $version['derived']['proxy']['url']);
		self::assertSame(200, $proxy['status']);
		self::assertNotSame('', $proxy['body']);

		// Frame anchors hold only while the Proxy runs at the source rate
		$copy = sys_get_temp_dir() . '/deliver-proxy-' . bin2hex(random_bytes(4)) . '.mp4';
		file_put_contents($copy, $proxy['body']);
		[, $probed] = $this->shell(sprintf(
			'ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,avg_frame_rate -of csv=p=0 %s',
			escapeshellarg($copy),
		));
		@unlink($copy);
		self::assertStringContainsString('h264', $probed);
		self::assertStringContainsString('24000/1001', $probed, 'the Proxy runs at the source rate, not a rounded one');

		$ranged = $this->nc->request('GET', $version['derived']['proxy']['url'], null, ['Range: bytes=0-99']);
		self::assertSame(206, $ranged['status'], 'ranges let the player seek');
		self::assertSame(100, strlen($ranged['body']));
		self::assertSame(416, $this->nc->request('GET', $version['derived']['proxy']['url'], null, ['Range: bytes=999999999-'])['status']);
	}

	public function testTheThumbnailStripAndWaveformDescribeTheirOwnShape(): void {
		$this->makeFixture();
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		$versionId = $shown['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		$index = json_decode($this->nc->request('GET', $version['derived']['thumbs']['index'])['body'], true);
		self::assertSame(['num' => 24000, 'den' => 1001], $index['fps'], 'the index carries the rate its Frames are counted at');
		self::assertGreaterThan(0, $index['count']);
		self::assertGreaterThanOrEqual($index['count'], $index['columns'] * $index['rows'], 'every Frame has a tile');

		$strip = $this->nc->request('GET', $version['derived']['thumbs']['url']);
		self::assertSame(200, $strip['status']);
		self::assertStringStartsWith('RIFF', $strip['body'], 'a WebP image');

		$waveform = $this->nc->waveform($version['derived']['waveform']['url']);
		$seconds = $version['durationFrames'] * $version['fps']['den'] / $version['fps']['num'];
		self::assertSame(50, $waveform['rate'], 'peaks at a fixed rate, whatever the length');
		self::assertEqualsWithDelta($seconds * 50, count($waveform['peaks']), 2, 'each peak 20 ms of the sound');
		self::assertGreaterThan(0, max($waveform['peaks']), 'the sound is heard');
	}

	public function testAWaveformFromBeforeTheFixedRateIsMadeAgainOnceNothingElseWaitsOrWhenOpened(): void {
		$mp3 = sys_get_temp_dir() . '/deliver-take-' . bin2hex(random_bytes(4)) . '.mp3';
		[$code, $output] = $this->shell('ffmpeg -v error -y -f lavfi -i sine=duration=3 -c:a libmp3lame ' . escapeshellarg($mp3));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/old.mp3", (string)file_get_contents($mp3));
		$this->nc->put("{$this->root}/opened.mp3", (string)file_get_contents($mp3));
		$this->nc->put("{$this->root}/linked.mp3", (string)file_get_contents($mp3));
		@unlink($mp3);
		$this->drainQueue();
		[$old, $opened, $linked] = [$this->idOf('old.mp3'), $this->idOf('opened.mp3'), $this->idOf('linked.mp3')];
		self::assertSame('ready', $this->version($old)['derived']['waveform']['state']);

		$this->inNextcloud('(new \\OCA\\Deliver\\Migration\\Version1021Date20261120000000(\\OCP\\Server::get(\\OCP\\IDBConnection::class)))->postSchemaChange(new \\OC\\Migration\\NullOutput(), fn () => null, []);');
		self::assertSame('none', $this->waveformState($old), 'the Waveform from before counts as missing');

		self::assertSame(['queued', null], array_values($this->version($opened)['derived']['waveform']), 'opening it queues its Waveform, ahead of the rest');
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$seen = array_values(array_filter($reviewer->call('GET', "/api/context?versionId=$linked")['data']['versions'], static fn (array $each) => $each['id'] === $linked))[0];
		self::assertSame('queued', $seen['derived']['waveform']['state'], 'a Reviewer opening it too, and the page says so, so it asks again');
		$this->makeFixture();
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		self::assertSame('NULL none', trim($this->inNextcloud('var_export(\\OCP\\Server::get(\\OCA\\Deliver\\Service\\DerivedMedia::class)->queueMissingWaveform()); echo " ", \\OCP\\Server::get(\\OCA\\Deliver\\Db\\VersionMapper::class)->find(' . $old . ')->getWaveformState();')), 'it waits while an upload has work queued');

		// The worker runs out of other work, then makes it
		$this->drainQueue();
		$version = $this->version($old);
		self::assertSame('ready', $version['derived']['waveform']['state']);
		$waveform = $this->nc->waveform($version['derived']['waveform']['url']);
		self::assertSame(50, $waveform['rate']);
		self::assertEqualsWithDelta(150, count($waveform['peaks']), 3, 'three seconds at 50 a second');
	}

	public function testAudioHasItsWaveformWhenItsUploadIsDone(): void {
		$mp3 = sys_get_temp_dir() . '/deliver-take-' . bin2hex(random_bytes(4)) . '.mp3';
		[$code, $output] = $this->shell('ffmpeg -v error -y -f lavfi -i sine=duration=4 -c:a libmp3lame ' . escapeshellarg($mp3));
		self::assertSame(0, $code, $output);
		$this->makeFixture();
		// A video first, whose Proxy, Thumbnail Strip and Scrub Proxy would be ahead in the queue
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$this->nc->put("{$this->root}/take.mp3", (string)file_get_contents($mp3));
		@unlink($mp3);

		// No worker, no cron: what is there came with the upload
		$take = $this->version($this->idOf('take.mp3'));
		self::assertTrue($take['audioOnly']);
		self::assertSame('ready', $take['derived']['waveform']['state'], 'read and drawn in the request that took it in');
		self::assertEqualsWithDelta(200, count($this->nc->waveform($take['derived']['waveform']['url'])['peaks']), 5, 'four seconds');
		self::assertNull($this->version($this->idOf('master.mov'))['playable'], 'a video waits for the queue');

		$order = $this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10) as $job) { echo $job->getKind(), " "; }');
		self::assertSame('probe', trim($order));
		$this->inNextcloud('$jobs = \\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class); $job = $jobs->findQueued(1)[0]; $jobs->claim($job, "test", time()); \\OCP\\Server::get(\\OCA\\Deliver\\Service\\DerivedMedia::class)->process($job);');
		$order = $this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10) as $job) { echo $job->getKind(), " "; }');
		self::assertSame('proxy thumbs waveform scrub', trim($order), 'a video\'s Waveform reads the whole master, so it keeps its place after the Proxy');
		// Audio too long for its request: its Waveform goes before the video's Proxy
		$long = $this->mp3('long.mp3', 1860);
		$this->nc->put("{$this->root}/long.mp3", (string)file_get_contents($long));
		@unlink($long);
		$order = $this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10) as $job) { echo $job->getKind(), " "; }');
		self::assertSame('waveform proxy thumbs waveform scrub', trim($order), 'audio\'s Waveform takes seconds, so it goes first');
	}

	/** A sine of so many seconds, as MP3 or FLAC by the name's extension */
	private function mp3(string $name, int $seconds): string {
		$file = sys_get_temp_dir() . '/deliver-' . bin2hex(random_bytes(4)) . '-' . $name;
		$codec = str_ends_with($name, '.flac') ? 'flac' : 'libmp3lame -b:a 8k';
		[$code, $output] = $this->shell("ffmpeg -v error -y -f lavfi -i sine=duration=$seconds -ac 1 -ar 8000 -c:a $codec " . escapeshellarg($file));
		self::assertSame(0, $code, $output);
		return $file;
	}

	public function testAudioTooLongForARequestOrOneTooManyAtOnceIsLeftToTheQueue(): void {
		// Half an hour and a minute
		$long = $this->mp3('long.mp3', 1860);
		$this->nc->put("{$this->root}/long.mp3", (string)file_get_contents($long));
		@unlink($long);
		$version = $this->version($this->idOf('long.mp3'));
		self::assertGreaterThan(1800000, $version['durationFrames'], 'read in the request');
		self::assertSame('queued', $version['derived']['waveform']['state'], 'its Waveform in the queue');

		// Its STREAMINFO says two seconds, the sound goes on for a minute: the request stops where the header ends
		$head = $this->mp3('head.flac', 2);
		$tail = $this->mp3('tail.flac', 60);
		$this->nc->put("{$this->root}/liar.flac", file_get_contents($head) . file_get_contents($tail));
		@unlink($head);
		@unlink($tail);
		$version = $this->version($this->idOf('liar.flac'));
		self::assertLessThan(3000, $version['durationFrames']);
		self::assertSame('queued', $version['derived']['waveform']['state'], 'more sound than its header says is the queue\'s');
		self::assertSame('queued', trim($this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findPending(' . $version['id'] . ', "waveform")->getState();')), 'and its job is put back');

		// A request making a Waveform already fills max_jobs (1)
		$busy = $this->inNextcloud('$job = new \\OCA\\Deliver\\Db\\Job(); $job->setKind("waveform"); $job->setVersionId(' . $version['id'] . '); $job->setState("running"); $job->setClaimedBy("request"); $job->setCreatedAt(time()); $job->setStartedAt(time()); echo \\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->insert($job)->getId();');
		$short = $this->mp3('short.mp3', 3);
		$this->nc->put("{$this->root}/short.mp3", (string)file_get_contents($short));
		@unlink($short);
		self::assertSame('none', $this->waveformState($this->idOf('short.mp3')), 'not read in the request: its probe waits in the queue');

		// A request that died ten minutes ago leaves its job to the queue again
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_jobs")->set("started_at", $q->createNamedParameter(time() - 600))->where($q->expr()->eq("id", $q->createNamedParameter(' . (int)$busy . ')))->executeStatement();');
		$this->drainQueue();
		foreach (['long.mp3', 'liar.flac', 'short.mp3'] as $name) {
			self::assertSame('ready', $this->waveformState($this->idOf($name)), $name);
		}
		self::assertSame('', trim($this->inNextcloud('foreach (\\OCP\\Server::get(\\OCA\\Deliver\\Db\\JobMapper::class)->findQueued(10) as $job) { echo $job->getKind(); }')), 'nothing stuck');
	}

	public function testCronDrainsTheQueueAtEveryRun(): void {
		// A cron every five minutes starts the job a few seconds into its run: an interval of five minutes misses every other one
		self::assertLessThanOrEqual(60, (int)$this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\BackgroundJob\\ProcessDerivedMedia::class)->getInterval();'));
	}

	public function testAWaveformWhileIdleThatFailsOrCannotBeReadPausesTheRest(): void {
		foreach (['first.mp3', 'second.mp3'] as $name) {
			$mp3 = $this->mp3($name, 2);
			$this->nc->put("{$this->root}/$name", (string)file_get_contents($mp3));
			@unlink($mp3);
		}
		$this->drainQueue();
		[$first, $second] = [$this->idOf('first.mp3'), $this->idOf('second.mp3')];
		foreach ([$first, $second] as $id) {
			$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_versions")->set("waveform_state", $q->createNamedParameter("none"))->where($q->expr()->eq("id", $q->createNamedParameter(' . $id . ')))->executeStatement();');
		}
		$disk = "/var/www/html/data/admin/files/{$this->root}/second.mp3";

		// The newest goes first; its file is gone from the disk behind Nextcloud's back, as on storage that went offline
		rename($disk, "$disk.away");
		$this->drainQueue();
		self::assertSame(['none', 'none'], [$this->waveformState($second), $this->waveformState($first)], 'nothing is failed for a file that is not there, and the rest waits');
		self::assertGreaterThan(time(), (int)$this->inNextcloud('echo \\OCP\\Server::get(\\OCP\\IAppConfig::class)->getValueInt("deliver", "idle_waveforms_after");'), 'for an hour, across cron runs');

		// An hour on, the look goes on past it instead of stopping at it again
		$this->shell('php /var/www/html/occ config:app:delete deliver idle_waveforms_after');
		$this->drainQueue();
		self::assertSame(['none', 'ready'], [$this->waveformState($second), $this->waveformState($first)], 'the next one is made');

		// Back, but no sound in it any more: a failure of its own, which pauses the rest as well
		rename("$disk.away", $disk);
		file_put_contents($disk, str_repeat("\0", 4096));
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_versions")->set("waveform_state", $q->createNamedParameter("none"))->where($q->expr()->eq("id", $q->createNamedParameter(' . $first . ')))->executeStatement();');
		$this->resumeIdle();
		$this->drainQueue();
		self::assertSame(['failed', 'none'], [$this->waveformState($second), $this->waveformState($first)], 'one failure stops the idle work');
	}

	private function resumeIdle(): void {
		$this->shell('php /var/www/html/occ config:app:delete deliver idle_waveforms_after');
		$this->shell('php /var/www/html/occ config:app:delete deliver idle_waveforms_below');
	}

	public function testAFolderTakenInAtOnceLeavesItsAudioToTheQueue(): void {
		$folder = $this->root . '-stems';
		$this->nc->mkdir($folder);
		try {
			foreach (['bass.mp3', 'drums.mp3', 'vox.mp3'] as $name) {
				$mp3 = $this->mp3($name, 2);
				$this->nc->put("$folder/$name", (string)file_get_contents($mp3));
				@unlink($mp3);
			}
			$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($folder), 'autoIntake' => true]);
			self::assertSame(201, $created['status'], json_encode($created['data']));
			$assets = $this->nc->ocs('GET', "/projects/{$created['data']['id']}")['data']['assets'];
			self::assertCount(3, $assets);
			foreach ($assets as $asset) {
				self::assertSame('none', $this->waveformState($asset['versions'][0]['id']), 'not read in the request that made the Project');
			}
		} finally {
			if (isset($created['data']['id'])) {
				$this->nc->deleteProject($created['data']['id']);
			}
			$this->nc->delete($folder);
		}
	}

	public function testAFileMadeEmptyAndWrittenAfterIsReadWhenItsContentComes(): void {
		// As Finder and Windows put a file over WebDAV: empty first, then its content
		self::assertSame(201, $this->nc->davStatus('PUT', "{$this->root}/late.mp3", ''));
		$late = $this->idOf('late.mp3');
		self::assertSame('none', $this->waveformState($late));
		self::assertNull($this->version($late)['derived']['error'], 'no failed read of nothing');
		$mp3 = $this->mp3('late.mp3', 2);
		$this->nc->put("{$this->root}/late.mp3", (string)file_get_contents($mp3));
		@unlink($mp3);
		self::assertSame('ready', $this->waveformState($late), 'read and drawn in the request that brought the content');
	}

	public function testATrackWithoutASampleHasAnEmptyWaveform(): void {
		$wav = sys_get_temp_dir() . '/deliver-empty-' . bin2hex(random_bytes(4)) . '.wav';
		[$code, $output] = $this->shell('ffmpeg -v error -y -f lavfi -i anullsrc=r=48000:cl=stereo -t 0 ' . escapeshellarg($wav));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/empty.wav", (string)file_get_contents($wav));
		@unlink($wav);
		$this->drainQueue();
		$version = $this->version($this->idOf('empty.wav'));
		self::assertSame('ready', $version['derived']['waveform']['state'], 'silent, not failed');
		self::assertSame([], $this->nc->waveform($version['derived']['waveform']['url'])['peaks']);
	}

	public function testFfmpegsWaveformHearsEveryChannelAndHighNotes(): void {
		$flac = sys_get_temp_dir() . '/deliver-phase-' . bin2hex(random_bytes(4)) . '.flac';
		// A 6 kHz tone at half of full scale, the right side out of phase with the left
		[$code, $output] = $this->shell('ffmpeg -v error -y -f lavfi -i "aevalsrc=0.5*sin(2*PI*6000*t)|-0.5*sin(2*PI*6000*t):d=2:s=48000" -c:a flac ' . escapeshellarg($flac));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/phase.flac", (string)file_get_contents($flac));
		@unlink($flac);
		$this->drainQueue();
		$peaks = $this->nc->waveform($this->version($this->idOf('phase.flac'))['derived']['waveform']['url'])['peaks'];
		self::assertCount(100, $peaks);
		self::assertEqualsWithDelta(128, min(array_slice($peaks, 1, 98)), 8, 'neither a mono mix nor 8 kHz would hear it');

		$mono = sys_get_temp_dir() . '/deliver-mono-' . bin2hex(random_bytes(4)) . '.flac';
		[$code, $output] = $this->shell('ffmpeg -v error -y -f lavfi -i "aevalsrc=0.5*sin(2*PI*440*t):d=2:s=48000" -c:a flac ' . escapeshellarg($mono));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/mono.flac", (string)file_get_contents($mono));
		@unlink($mono);
		$this->drainQueue();
		$peaks = $this->nc->waveform($this->version($this->idOf('mono.flac'))['derived']['waveform']['url'])['peaks'];
		self::assertEqualsWithDelta(128, max($peaks), 3, 'mono at its own level, not 3 dB down as stereo');
	}

	/** The state of a Version's Waveform as the database has it, without opening the Version, which would queue it */
	private function waveformState(int $versionId): string {
		return $this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\Db\\VersionMapper::class)->find(' . $versionId . ')->getWaveformState();');
	}

	private function idOf(string $name): int {
		foreach ($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'] as $asset) {
			if ($asset['versions'][0]['name'] === $name) {
				return $asset['versions'][0]['id'];
			}
		}
		self::fail("No Asset $name");
	}

	/** Runs PHP inside this Nextcloud, for what no API does */
	private function inNextcloud(string $code): string {
		[$status, $output] = $this->shell('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; ' . $code));
		self::assertSame(0, $status, $output);
		return $output;
	}

	public function testRegeneratingDeletesTheDerivedMediaAndMakesItAgain(): void {
		$this->makeFixture();
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		$versionId = $shown['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();
		self::assertSame('ready', $this->version($versionId)['derived']['proxy']['state']);

		[$code, $output] = $this->shell("php /var/www/html/occ deliver:regenerate --version-id=$versionId");
		self::assertSame(0, $code, $output);
		self::assertSame('none', $this->version($versionId)['derived']['proxy']['state'], 'the old Proxy is gone and nothing claims otherwise');

		$this->drainQueue();
		self::assertSame('ready', $this->version($versionId)['derived']['proxy']['state']);
	}

	/** @return string what ffprobe says about the Proxy's video stream and title */
	private function probeProxy(array $version): string {
		$proxy = $this->nc->request('GET', $version['derived']['proxy']['url']);
		self::assertSame(200, $proxy['status']);
		$copy = sys_get_temp_dir() . '/deliver-proxy-' . bin2hex(random_bytes(4)) . '.mp4';
		file_put_contents($copy, $proxy['body']);
		[, $probed] = $this->shell(sprintf(
			'ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,avg_frame_rate:format_tags=title -of default=nw=1 %s',
			escapeshellarg($copy),
		));
		@unlink($copy);
		return $probed;
	}

	/** Uploads the fixture and runs the queue; @return array<string, mixed> the Version afterwards */
	private function processedVersion(): array {
		$this->makeFixture();
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();
		return $this->version($versionId);
	}

	public function testBrowsersMakeNoProxyWhileTheServerHasFfmpeg(): void {
		// A light MP4 plays as it is, so it has no Proxy that would make the 409 for another reason
		[$code, $output] = $this->shell(sprintf('ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p -f mp4 %s', escapeshellarg($this->fixture)));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/master.mp4", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();
		self::assertSame('none', $this->version($versionId)['derived']['proxy']['state']);

		self::assertSame(409, $this->nc->ocs('POST', "/versions/$versionId/proxy/progress", ['percent' => 5])['status'], 'the progress call is what guards the rule: the server makes Proxies (ADR 0019)');
		self::assertSame('none', $this->version($versionId)['derived']['proxy']['state']);
	}

	public function testAHardwareProxyAboveTheThresholdIsMadeAgainInSoftware(): void {
		if (!file_exists('/dev/dri/renderD128')) {
			self::markTestSkipped('no VAAPI device in this container');
		}
		$saved = $this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'vaapi', 'hwDevice' => '/dev/dri/renderD128', 'maxBitrate' => 2]);
		self::assertSame(200, $saved['status'], json_encode($saved['data']));
		self::assertTrue($saved['data']['settings']['hwEncoderOk'], (string)$saved['data']['settings']['hwEncoderError']);
		// Noise: a constant-quality VAAPI encode of it goes far above 2 Mbit/s
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=1280x720:rate=25:duration=5,noise=alls=60:allf=t" -c:v prores_ks -profile:v 0 %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
		$bytes = strlen($this->nc->request('GET', $version['derived']['proxy']['url'])['body']);
		self::assertLessThan(2_000_000, $bytes * 8 / 5, 'below the threshold of 2 Mbit/s, so made again in software');
	}

	public function testVaapiIsTestedOnSaveAndKeepsTheFrameRate(): void {
		if (!file_exists('/dev/dri/renderD128')) {
			self::markTestSkipped('no VAAPI device in this container');
		}
		$saved = $this->nc->ocs('PUT', '/admin/settings', [
			'hwEncoder' => 'vaapi',
			'hwDevice' => '/dev/dri/renderD128',
			'extraArgs' => '-metadata title="Deliver test"',
		]);
		self::assertSame(200, $saved['status'], json_encode($saved['data']));
		self::assertTrue($saved['data']['settings']['hwEncoderOk'], (string)$saved['data']['settings']['hwEncoderError']);
		self::assertSame('vaapi', $saved['data']['status']['encoder']);

		$version = $this->processedVersion();
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
		$probed = $this->probeProxy($version);
		self::assertStringContainsString('codec_name=h264', $probed);
		self::assertStringContainsString('avg_frame_rate=24000/1001', $probed, 'the hardware encoder keeps the source rate too');
		self::assertStringContainsString('TAG:title=Deliver test', $probed, 'the extra arguments reach ffmpeg, quotes and all');
	}

	public function testAnEncoderThatFailsFallsBackToSoftware(): void {
		$saved = $this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'nvenc']);
		self::assertSame(200, $saved['status'], json_encode($saved['data']));
		self::assertFalse($saved['data']['settings']['hwEncoderOk'], 'no NVIDIA card here, so the test encode fails');
		self::assertNotEmpty($saved['data']['settings']['hwEncoderError']);
		self::assertSame('none', $saved['data']['status']['encoder'], 'and Proxies are made in software');

		// An encoder that passed its test but breaks later still does not block the queue
		$this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'vaapi', 'hwDevice' => '/dev/nothing-here']);
		[$code, $output] = $this->shell('php /var/www/html/occ config:app:set deliver hw_encoder_ok --value=1 --type=boolean');
		self::assertSame(0, $code, $output);

		$version = $this->processedVersion();
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
		self::assertStringContainsString('avg_frame_rate=24000/1001', $this->probeProxy($version));
	}

	public function testOnlyAdminsSeeThePipelineSettings(): void {
		$shown = $this->nc->ocs('GET', '/admin/settings');
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		self::assertStringStartsWith('ffmpeg version', (string)$shown['data']['status']['ffmpeg']);
		self::assertArrayHasKey('states', $shown['data']['status']);
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['maxJobs' => 0])['status']);
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'quicksync'])['status']);
		self::assertSame('/Deliver', $shown['data']['settings']['projectFolder'], 'new Projects get their folder in /Deliver unless an admin says otherwise');
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['projectFolder' => 'Deliver'])['status'], 'a path starts at /');

		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		try {
			self::assertSame(403, $this->nc->withUser($user, $password)->ocs('GET', '/admin/settings')['status']);
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
	}

	public function testDerivedMediaStaysClosedWhereNextcloudHidesTheContent(): void {
		$version = $this->processedVersion();
		$user = 'deliver-viewer-' . bin2hex(random_bytes(4));
		$password = 'Viewer-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		try {
			$shared = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
				'path' => "/{$this->root}/master.mov", 'shareType' => 0, 'shareWith' => $user, 'permissions' => 1,
				'attributes' => json_encode([['scope' => 'permissions', 'key' => 'download', 'value' => false]]),
			]);
			self::assertSame(200, $shared['status'], json_encode($shared['data']));
			$viewer = $this->nc->withUser($user, $password);
			self::assertSame(200, $viewer->request('GET', $version['derived']['proxy']['url'])['status'], 'viewing without download is allowed unless the admin says otherwise');

			// Through the API, as occ would miss the web server's cache of it
			$switch = '/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/core/shareapi_allow_view_without_download';
			self::assertSame(200, $this->nc->ocsForm('POST', $switch, ['value' => 'false'])['status']);
			self::assertSame(404, $viewer->request('GET', $version['derived']['proxy']['url'])['status'], 'the Proxy shows the content Nextcloud hides');
		} finally {
			$this->nc->ocsForm('POST', '/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/core/shareapi_allow_view_without_download', ['value' => 'true']);
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
	}

	public function testAHeavyOriginalStaysTheDefaultAndGetsALighterProxy(): void {
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['maxHeight' => 719])['status'], 'no Proxy below 720p');
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['maxBitrate' => 1])['status'], 'no Proxy fits below 2 Mbit/s');
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['maxHeight' => 720, 'maxBitrate' => 2])['status']);
		// Portrait H.264 at 900x1600 full of noise: browsers play it, but it is far above 2 Mbit/s
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=900x1600:rate=25:duration=5,noise=alls=40:allf=t" '
			. '-f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -f mp4 %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/portrait.mp4", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertTrue($version['playable'], 'the original plays as it is');
		self::assertNotNull($version['url']);
		self::assertSame(900, $version['resolution']);
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
		self::assertSame(720, $version['derived']['proxy']['resolution']);

		$proxy = $this->nc->request('GET', $version['derived']['proxy']['url']);
		$copy = sys_get_temp_dir() . '/deliver-proxy-' . bin2hex(random_bytes(4)) . '.mp4';
		file_put_contents($copy, $proxy['body']);
		[, $probed] = $this->shell('ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ' . escapeshellarg($copy));
		@unlink($copy);
		self::assertSame('720,1280', trim($probed), 'the limit applies to the short side, so portrait stays portrait');
		self::assertLessThanOrEqual(2_000_000, strlen($proxy['body']) * 8 / 5, 'no Proxy goes above the threshold it is made for');
	}

	public function testALargeOriginalBelowTheThresholdGetsNoProxy(): void {
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['maxHeight' => 720])['status']);
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i testsrc=size=900x1600:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p -f mp4 %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/portrait.mp4", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertTrue($version['playable']);
		self::assertSame('none', $version['derived']['proxy']['state'], 'above the Proxy resolution, but light enough to play as it is');
	}

	public function testAv1GetsAProxy(): void {
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=25:duration=1 -c:v libaom-av1 -cpu-used 8 -crf 40 -f webm %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/cut.webm", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertFalse($version['playable'], 'AV1 plays only on recent Apple hardware');
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
	}
}
