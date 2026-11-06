<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * An install without ffmpeg (ADR 0003, story 73) still reads what Frames
 * rest on: the frame rate and the start timecode of a MOV or MP4, and the
 * time reference of a Broadcast WAV. Otherwise every marker lands off in the
 * editing application, whose timelines start at 01:00:00:00.
 *
 * ffmpeg makes the fixtures; Deliver is pointed at binaries that do not exist.
 */
class WithoutFfmpegTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

	protected function setUp(): void {
		exec('ffmpeg -version 2>&1', $output, $code);
		if ($code !== 0) {
			self::markTestSkipped('no ffmpeg to make the fixtures');
		}
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$gone = $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe']);
		self::assertSame(200, $gone['status'], json_encode($gone['data']));
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->fixture = sys_get_temp_dir() . '/deliver-noffmpeg-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => '']);
		$this->nc->ocsForm('DELETE', '/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/deliver/thumb_cap');
		$this->nc->ocsForm('DELETE', '/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/deliver/max_bitrate');
		$this->nc->deleteProject($this->projectId);
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	private function make(string $args): void {
		exec('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
	}

	/** @return array<string, mixed> the Version after its probe job ran */
	private function upload(string $name): array {
		$this->nc->put("{$this->root}/$name", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$shown = $this->nc->ocs('GET', "/versions/$versionId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['versions'][0];
	}

	private function edl(int $versionId, int $frame): string {
		self::assertSame(201, $this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => $frame, 'body' => 'here'])['status']);
		return $this->nc->request('GET', "/apps/deliver/versions/$versionId/export/edl")['body'];
	}

	public function testAMovFromTheEditKeepsItsFrameRateAndStartTimecode(): void {
		$this->make('-f lavfi -i testsrc=size=320x180:rate=24000/1001:duration=2 -c:v libx264 -pix_fmt yuv420p -timecode 01:00:00:00 -f mov');
		$version = $this->upload('cut.mov');

		self::assertSame(['num' => 24000, 'den' => 1001], $version['fps']);
		self::assertSame(86400, $version['startFrame'], '01:00:00:00 counts 24 Frames a second at 23.976');
		self::assertSame(48, $version['durationFrames']);
		self::assertStringContainsString('01:00:01:00 01:00:01:01', $this->edl($version['id'], 24));
		self::assertSame('none', $version['derived']['proxy']['state'], 'no ffmpeg, so no Proxy is queued only to fail');
	}

	public function testAnMp4AtDropFrameKeepsItsTimecode(): void {
		$this->make('-f lavfi -i testsrc=size=320x180:rate=30000/1001:duration=1 -c:v libx264 -pix_fmt yuv420p -timecode "10:00:00;00" -write_tmcd 1 -f mp4');
		$version = $this->upload('cut.mp4');

		self::assertSame(['num' => 30000, 'den' => 1001], $version['fps']);
		self::assertSame(1078920, $version['startFrame'], '10:00:00;00 in drop-frame counting');
		self::assertTrue($version['playable']);
	}

	public function testABroadcastWavKeepsItsTimeReference(): void {
		// 172800000 samples at 48 kHz: one hour after midnight
		$this->make('-f lavfi -i sine=duration=4 -ar 48000 -write_bext 1 -metadata time_reference=172800000 -f wav');
		$version = $this->upload('mix.wav');

		self::assertSame(['num' => 1000, 'den' => 1], $version['fps'], 'audio counts in milliseconds');
		self::assertSame(3600000, $version['startFrame']);
		self::assertSame(4000, $version['durationFrames']);
		self::assertTrue($version['playable'], 'a WAV plays in the browser as it is');
		self::assertTrue($version['wavExport'], 'a WAV takes its markers without ffmpeg');

		// The PCM is right there, so the server draws the Waveform itself
		self::assertSame('ready', $version['derived']['waveform']['state']);
		$peaks = json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true)['peaks'];
		self::assertCount(2000, $peaks);
		self::assertEqualsWithDelta(0.125, max($peaks), 0.01, 'the sine is an eighth of full scale');
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.5], 'durationFrames' => 4000])['status'], 'a browser does not overwrite it');
	}

	/** @return array<string, array{string, string, ?int}> */
	public static function audio(): array {
		return [
			'MP3' => ['-c:a libmp3lame -f mp3', 'take.mp3', null],
			'MP3 with an ID3 tag' => ['-c:a libmp3lame -metadata title=Take -id3v2_version 3 -f mp3', 'tagged.mp3', null],
			// STREAMINFO counts the samples
			'FLAC' => ['-c:a flac -f flac', 'take.flac', 2000],
			'Ogg Vorbis' => ['-c:a libvorbis -f ogg', 'take.ogg', null],
			'Ogg Opus' => ['-c:a libopus -f ogg', 'take.opus', null],
			'AAC' => ['-c:a aac -f adts', 'take.aac', null],
		];
	}

	#[DataProvider('audio')]
	public function testAudioIsKnownAsAudio(string $args, string $name, ?int $duration): void {
		$this->make("-f lavfi -i sine=duration=2 -ar 48000 $args");
		$version = $this->upload($name);

		self::assertTrue($version['audioOnly']);
		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertTrue($version['playable']);
		self::assertNull($version['derived']['error'], 'nothing failed');
		self::assertFalse($version['wavExport'], 'turning it into WAV needs ffmpeg');

		// The browser decodes it and hands in what the server cannot work out
		self::assertSame('none', $version['derived']['waveform']['state']);
		self::assertSame($duration, $version['durationFrames']);
		$given = $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.1, 0.5, 0.25], 'durationFrames' => 2000]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		$version = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('ready', $version['derived']['waveform']['state']);
		self::assertSame(2000, $version['durationFrames']);
		self::assertSame([0.1, 0.5, 0.25], json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true)['peaks']);
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.2], 'durationFrames' => 2000])['status'], 'once is enough');
	}

	/** @return array{0: int, 1: string} file id and path of a Proxy made here as the browser makes it, uploaded next to the Version's file under a name without a media extension */
	private function proxyFrom(string $args): array {
		$proxy = $this->fixture . '-proxy';
		exec('ffmpeg -v error -y ' . $args . ' -f mp4 ' . escapeshellarg($proxy) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$path = "{$this->root}/.deliver-proxy-" . bin2hex(random_bytes(4));
		$this->nc->put($path, (string)file_get_contents($proxy));
		unlink($proxy);
		return [$this->nc->fileId($path), $path];
	}

	/** Two seconds of ProRes at 25 fps with PCM, as a master comes out of the edit */
	private const PRORES = '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v prores_ks -profile:v 0 -c:a pcm_s16le -f mov';
	/** The Proxy of it, as the browser makes it: H.264/AAC at the same rate with as many Frames */
	private const PROXY = '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest';

	public function testTheUploadingBrowserHandsInTheProxyOfAProResMaster(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		self::assertFalse($version['playable'], 'no browser plays ProRes');
		self::assertSame('none', $version['derived']['proxy']['state']);
		self::assertSame(50, $version['durationFrames']);

		// While it converts, everyone sees how far it has got
		$reported = $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 40]);
		self::assertSame(200, $reported['status'], json_encode($reported['data']));
		$shown = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('running', $shown['derived']['proxy']['state']);
		self::assertSame(40, $shown['derived']['progress']);

		[$upload, $path] = $this->proxyFrom(self::PROXY);
		$given = $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $upload]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		$shown = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('ready', $shown['derived']['proxy']['state']);
		self::assertNull($shown['derived']['progress']);
		self::assertStringContainsString('ftyp', substr($this->nc->request('GET', $shown['derived']['proxy']['url'])['body'], 0, 12));
		self::assertCount(1, $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], 'the upload never became an Asset');
		self::assertSame(404, $this->nc->davStatus('PROPFIND', $path), 'the upload is gone');

		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]])['status'], 'a conversion never replaces a Proxy that is there');
	}

	/** @return array<string, array{string, string}> */
	public static function wrongProxies(): array {
		return [
			'a Frame short' => ['-f lavfi -i testsrc=size=640x360:rate=25:duration=1.96 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest', 'other Frames'],
			'another frame rate' => ['-f lavfi -i testsrc=size=640x360:rate=50:duration=1 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -r 50 -c:a aac -shortest', 'another frame rate'],
			'not playable' => ['-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv422p -c:a aac -shortest', 'no H.264/AAC MP4'],
			'silent' => ['-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p', 'no sound'],
			'above the Proxy resolution' => ['-f lavfi -i testsrc=size=2560x1440:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest', 'larger than the Proxy resolution'],
		];
	}

	#[DataProvider('wrongProxies')]
	public function testAProxyThatDoesNotFitIsRefused(string $args, string $why): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		// The browser's own attempt, which then shows as failed
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 99])['status']);

		$refused = $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom($args)[0]]);
		self::assertSame(400, $refused['status'], json_encode($refused['data']));
		$shown = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('failed', $shown['derived']['proxy']['state']);
		self::assertStringContainsString($why, (string)$shown['derived']['error']);
		self::assertCount(1, $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets']);
	}

	public function testAProxyHandedInBeforeTheBackgroundJobReadTheOriginalReadsItFirst(): void {
		$this->make(self::PRORES);
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$id = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		self::assertNull($this->nc->ocs('GET', "/versions/$id")['data']['versions'][0]['playable'], 'no background job ran yet');

		$given = $this->nc->ocs('POST', "/versions/$id/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame('ready', $this->nc->ocs('GET', "/versions/$id")['data']['versions'][0]['derived']['proxy']['state']);
	}

	public function testABrowserMakingAProxyHoldsUpNoBackgroundJob(): void {
		$this->make(self::PRORES);
		$first = $this->upload('master.mov');
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$first['id']}/proxy/progress", ['percent' => 5])['status']);

		// One job at a time by default: the browser's must not count as that one
		$this->make('-f lavfi -i testsrc=size=320x180:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p -f mp4');
		$this->nc->put("{$this->root}/other.mp4", (string)file_get_contents($this->fixture));
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$other = array_values(array_filter($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], static fn (array $asset) => $asset['versions'][0]['id'] !== $first['id']))[0]['versions'][0];
		self::assertTrue($this->nc->ocs('GET', "/versions/{$other['id']}")['data']['versions'][0]['playable'], 'the other file was read');
	}

	public function testOnlyAHeavyOrUnplayableOriginalTakesAProxy(): void {
		$this->make('-f lavfi -i "testsrc=size=640x360:rate=25:duration=2,noise=alls=40:allf=t" -f lavfi -i sine=duration=2 -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -shortest -f mp4');
		// About 6 Mbit/s: below the threshold of 20, above one of 2
		$version = $this->upload('cut.mp4');
		self::assertTrue($version['playable']);

		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]])['status'], 'it plays as it is');
		self::assertFalse($this->card()['proxyFromBrowser'], 'and is not offered one');
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['maxBitrate' => 2])['status']);
		try {
			self::assertTrue($this->card()['proxyFromBrowser'], 'above the Proxy bitrate threshold');
			$given = $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]]);
			self::assertSame(200, $given['status'], json_encode($given['data']));
		} finally {
			$this->nc->ocs('PUT', '/admin/settings', ['maxBitrate' => 20]);
		}
	}

	public function testOnlyWhoManagesTheVersionHandsInItsProxy(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		$user = 'deliver-viewer-' . bin2hex(random_bytes(3));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => 'Viewer-pass-123!']);
		try {
			$share = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => $this->root, 'shareType' => 0, 'shareWith' => $user, 'permissions' => 1]);
			self::assertSame(200, $share['status'], json_encode($share['data']));
			$viewer = $this->nc->withUser($user, 'Viewer-pass-123!');
			self::assertSame(403, $viewer->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 10])['status']);
			self::assertSame(403, $viewer->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]])['status']);
			self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]])['status']);
			self::assertSame(403, $viewer->ocs('DELETE', "/versions/{$version['id']}/proxy")['status'], 'nor removes it');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
	}

	/** @return array<string, mixed> the newest Version of the Project's only Asset, as its card has it */
	private function card(): array {
		return $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0];
	}

	public function testTheCardOffersTheProxyFromTheBrowserUntilOneIsOnItsWay(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		self::assertTrue($this->card()['proxyFromBrowser'], 'no Proxy, and none can come from the server');

		self::assertTrue($this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0]['proxyFromBrowser'], 'read again before a browser starts');
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 10])['status']);
		self::assertFalse($this->card()['proxyFromBrowser'], 'another browser is making it');
		self::assertFalse($this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0]['proxyFromBrowser'], 'so a second one does not start');

		// Two minutes without a report: that tab is gone, as the card sees too
		$this->inNextcloud('$q = \\OCP\\Server::get(\\OCP\\IDBConnection::class)->getQueryBuilder(); $q->update("deliver_jobs")->set("started_at", $q->createNamedParameter(1))->where($q->expr()->eq("version_id", $q->createNamedParameter(' . $version['id'] . ')))->executeStatement();');
		self::assertTrue($this->card()['proxyFromBrowser']);

		self::assertSame(400, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom('-f lavfi -i testsrc=size=640x360:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p')[0]])['status']);
		self::assertTrue($this->card()['proxyFromBrowser'], 'after a failed one too');
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom(self::PROXY)[0]])['status']);
		self::assertFalse($this->card()['proxyFromBrowser'], 'it has its Proxy');
	}

	public function testUploadsInTheFilesAppGetTheirProxyFromTheBrowserWhereAutoIntakeTakesThem(): void {
		$this->nc->mkdir("{$this->root}/day1");
		$intake = $this->nc->ocs('GET', '/folders/' . $this->nc->fileId("{$this->root}/day1") . '/intake');
		self::assertSame(200, $intake['status'], json_encode($intake['data']));
		self::assertSame(['maxHeight' => 1080, 'maxBitrate' => 20, 'thumbCap' => 600], $intake['data']['proxy'], 'below the Folder Project, with the settings to make them and their Thumbnail Strip to');

		$elsewhere = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($elsewhere);
		try {
			self::assertNull($this->nc->ocs('GET', '/folders/' . $this->nc->fileId($elsewhere) . '/intake')['data']['proxy'], 'no Project takes the files in there');
		} finally {
			$this->nc->delete($elsewhere);
		}
		self::assertSame(200, $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => false])['status']);
		self::assertNull($this->nc->ocs('GET', '/folders/' . $this->nc->fileId($this->root) . '/intake')['data']['proxy'], 'without Auto Intake they become no Assets');
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => ''])['status']);
		self::assertSame(200, $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => true])['status']);
		self::assertNull($this->nc->ocs('GET', '/folders/' . $this->nc->fileId($this->root) . '/intake')['data']['proxy'], 'ffmpeg makes them');
	}

	public function testOnlyWhoManagesTheFolderProjectMakesProxiesOfUploadsIntoIt(): void {
		$folderId = $this->nc->fileId($this->root);
		$user = 'deliver-viewer-' . bin2hex(random_bytes(3));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => 'Viewer-pass-123!']);
		try {
			$viewer = $this->nc->withUser($user, 'Viewer-pass-123!');
			self::assertSame(404, $viewer->ocs('GET', "/folders/$folderId/intake")['status'], 'out of reach');
			$share = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => $this->root, 'shareType' => 0, 'shareWith' => $user, 'permissions' => 1]);
			self::assertSame(200, $share['status'], json_encode($share['data']));
			$sharedId = $viewer->fileId(basename($this->root));
			$intake = $viewer->ocs('GET', "/folders/$sharedId/intake");
			self::assertSame(200, $intake['status'], json_encode($intake['data']));
			self::assertNull($intake['data']['proxy'], 'a read-only share manages nothing');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/{$this->projectId}")['status']);
		self::assertNull($this->nc->ocs('GET', "/folders/$folderId/intake")['data']['proxy'], 'a Deleted Project takes nothing in');
	}

	public function testOnlyThePagesWithDeliversScriptAllowItsDecoders(): void {
		$files = $this->nc->request('GET', '/apps/files/');
		self::assertSame(200, $files['status']);
		$policy = $files['headers']['content-security-policy'] ?? '';
		self::assertStringContainsString("'wasm-unsafe-eval'", $policy, 'the ProRes decoder and AAC encoder are WebAssembly');
		self::assertMatchesRegularExpression('/worker-src[^;]*blob:/', $policy, 'running in workers made from blobs');
		self::assertStringNotContainsString("'wasm-unsafe-eval'", $this->nc->request('GET', '/settings/user')['headers']['content-security-policy'] ?? '');
	}

	public function testDeliversOwnPageAllowsItsDecoders(): void {
		$page = $this->nc->request('GET', '/apps/deliver/');
		self::assertSame(200, $page['status']);
		$policy = $page['headers']['content-security-policy'] ?? '';
		self::assertStringContainsString("'wasm-unsafe-eval'", $policy, 'the Uploads dialog decodes ProRes and encodes AAC in WebAssembly');
		self::assertMatchesRegularExpression('/worker-src[^;]*blob:/', $policy, 'in workers made from blobs');
	}

	public function testAnOldBrowserProxyIsNotPutBackInTheQueueForAServerWorker(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 5])['status']);
		$id = (int)$version['id'];
		// Started longer ago than the two hours after which a server worker's job counts as dead
		$this->inNextcloud('\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeStatement("UPDATE *PREFIX*deliver_jobs SET started_at = started_at - 10800 WHERE kind = \'proxy\' AND version_id = ' . $id . '");');

		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));

		$job = $this->inNextcloud('echo json_encode(\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeQuery("SELECT state, claimed_by FROM *PREFIX*deliver_jobs WHERE kind = \'proxy\' AND version_id = ' . $id . '")->fetchAll());');
		self::assertSame([['state' => 'running', 'claimed_by' => 'browser']], json_decode($job, true), 'a browser job lapses on its own, no server worker takes it');
	}

	/** @return string a one-colour image of that size, base64 */
	private function image(string $size, string $format = 'webp'): string {
		$file = $this->fixture . '-strip';
		exec('ffmpeg -v error -y -f lavfi -i color=size=' . $size . ' -frames:v 1 -f ' . $format . ' ' . escapeshellarg($file) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		try {
			return base64_encode((string)file_get_contents($file));
		} finally {
			@unlink($file);
		}
	}

	public function testTheBrowserHandsInTheThumbnailStripOfItsProxyPassInTheServersShape(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		$thumbs = fn (string $image, int $every = 1, int $count = 2) => $this->nc->ocs('POST', "/versions/{$version['id']}/thumbs", ['image' => $image, 'every' => $every, 'count' => $count]);

		// Two seconds: a picture a second, two side by side, 160 wide, 90 high at 16:9
		self::assertSame(400, $thumbs($this->image('480x90'))['status'], 'three columns where two are');
		self::assertSame(400, $thumbs($this->image('320x91'))['status'], 'of odd height');
		self::assertSame(400, $thumbs($this->image('320x90', 'image2 -c:v png'))['status'], 'a PNG');
		self::assertSame(400, $thumbs($this->image('320x90'), every: 5)['status'], 'a picture every five seconds of two');
		self::assertSame(400, $thumbs($this->image('320x180'), count: 4)['status'], 'four pictures of two seconds, one a second');
		self::assertSame(400, $thumbs('not base64!')['status']);
		self::assertSame('none', $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0]['derived']['thumbs']['state']);

		$taken = $thumbs($this->image('320x90'));
		self::assertSame(200, $taken['status'], json_encode($taken['data']));
		self::assertSame([], $taken['data']);
		self::assertSame('ready', $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0]['derived']['thumbs']['state']);
		$index = json_decode($this->nc->request('GET', "/apps/deliver/versions/{$version['id']}/media/thumbsIndex")['body'], true);
		self::assertSame(['every' => 1, 'count' => 2, 'columns' => 2, 'rows' => 1, 'width' => 160, 'fps' => ['num' => 25, 'den' => 1]], $index);
		self::assertSame(409, $thumbs($this->image('320x90'))['status'], 'it has one');
	}

	/** As an admin sets it through occ, which checks no range (the provisioning API, as occ misses the web server's app-config cache) */
	private function occ(string $key, int $value): void {
		$set = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/provisioning_api/api/v1/config/apps/deliver/' . $key, ['value' => (string)$value]);
		self::assertSame(200, $set['status'], json_encode($set['data']));
	}

	public function testTheServerHoldsAProxyToTheSettingsTheBrowserWasGiven(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		$folder = $this->nc->fileId($this->root);
		// Above the range as well
		$this->occ('thumb_cap', 99999);
		$this->occ('max_bitrate', 500);
		self::assertSame(['maxHeight' => 1080, 'maxBitrate' => 200, 'thumbCap' => 5000], $this->nc->ocs('GET', "/folders/$folder/intake")['data']['proxy']);
		// Out of range: the browser is told the nearest number in range, and the server must keep to that as well
		$this->occ('thumb_cap', 1);
		$this->occ('max_bitrate', 1);
		self::assertSame(['maxHeight' => 1080, 'maxBitrate' => 2, 'thumbCap' => 10], $this->nc->ocs('GET', "/folders/$folder/intake")['data']['proxy']);

		$taken = $this->nc->ocs('POST', "/versions/{$version['id']}/thumbs", ['image' => $this->image('320x90'), 'every' => 1, 'count' => 2]);
		self::assertSame(200, $taken['status'], 'two pictures of two seconds are within a cap of ten: ' . json_encode($taken['data']));

		// Noise at 640x360 is far above 2 Mbit/s
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 99])['status']);
		$refused = $this->nc->ocs('POST', "/versions/{$version['id']}/proxy", ['converted' => true, 'fileId' => $this->proxyFrom('-f lavfi -i color=size=640x360:rate=25:duration=2,noise=alls=100:allf=t -f lavfi -i sine=duration=2 -c:v libx264 -crf 10 -pix_fmt yuv420p -c:a aac -shortest')[0]]);
		self::assertSame(400, $refused['status'], json_encode($refused['data']));
		$shown = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('failed', $shown['derived']['proxy']['state']);
		self::assertStringContainsString('above the Proxy bitrate threshold of 2 Mbit/s', (string)$shown['derived']['error']);
	}

	public function testASafariHandsInItsThumbnailStripAsJpegAndItIsServedAsSuch(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		$thumbs = fn (string $image) => $this->nc->ocs('POST', "/versions/{$version['id']}/thumbs", ['image' => $image, 'every' => 1, 'count' => 2]);
		$jpeg = fn (string $size) => $this->image($size, 'image2 -c:v mjpeg -pix_fmt yuvj420p');

		self::assertSame(404, $this->nc->request('GET', "/apps/deliver/versions/{$version['id']}/media/thumbs")['status']);

		self::assertSame(200, $thumbs($jpeg('320x90'))['status']);
		$strip = $this->nc->request('GET', "/apps/deliver/versions/{$version['id']}/media/thumbs");
		self::assertSame(200, $strip['status']);
		self::assertStringStartsWith('image/jpeg', $strip['headers']['content-type']);
		self::assertStringStartsWith("\xFF\xD8", $strip['body']);
		self::assertSame(404, $this->nc->request('GET', "/apps/deliver/versions/{$version['id']}/media/thumbsJpeg")['status'], 'the strip has one URL');
	}

	public function testOnlyWhoManagesAVideoHandsInItsThumbnailStripAlsoBeforeTheBackgroundJobReadIt(): void {
		$thumbs = fn (NextcloudClient $as, int $id) => $as->ocs('POST', "/versions/$id/thumbs", ['image' => $this->image('320x90'), 'every' => 1, 'count' => 2])['status'];
		$this->make('-f lavfi -i sine=duration=2 -f wav');
		self::assertSame(409, $thumbs($this->nc, $this->upload('mix.wav')['id']), 'no picture');

		$this->make(self::PRORES);
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		$assets = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		$versionId = array_values(array_filter($assets, static fn (array $asset) => $asset['versions'][0]['name'] === 'master.mov'))[0]['versions'][0]['id'];

		$user = 'deliver-viewer-' . bin2hex(random_bytes(3));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => 'Viewer-pass-123!']);
		try {
			self::assertSame(200, $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => $this->root, 'shareType' => 0, 'shareWith' => $user, 'permissions' => 1])['status']);
			self::assertSame(403, $thumbs($this->nc->withUser($user, 'Viewer-pass-123!'), $versionId), 'Manage, as for the Proxy');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}

		// A pass without a Proxy before it may be quicker than the background job: the request reads the original (#168)
		self::assertSame(200, $thumbs($this->nc, $versionId));
		self::assertSame(25, $this->nc->ocs('GET', "/versions/$versionId")['data']['versions'][0]['fps']['num']);
	}

	/** @return list<string> what the card and the Version say a browser is to make of the Version (the Project's only one by default), which must agree */
	private function fromBrowser(?int $versionId = null): array {
		$cards = array_map(static fn (array $asset) => $asset['versions'][0], $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets']);
		$card = $versionId === null ? $cards[0] : array_values(array_filter($cards, static fn (array $each) => $each['id'] === $versionId))[0];
		self::assertSame($card['derivedFromBrowser'], $this->nc->ocs('GET', "/versions/{$card['id']}")['data']['versions'][0]['derivedFromBrowser'], 'read again before a browser starts');
		return $card['derivedFromBrowser'];
	}

	public function testABrowserMakesWhatAVideoLacksUntilItHasItAll(): void {
		$this->make('-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest -f mp4');
		$version = $this->upload('cut.mp4');
		self::assertSame(['thumbs', 'waveform', 'scrub'], $this->fromBrowser(), 'it plays as it is, so no Proxy');

		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.1, 0.5], 'durationFrames' => 50])['status']);
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/thumbs", ['image' => $this->image('320x90'), 'every' => 1, 'count' => 2])['status']);
		self::assertSame(['scrub'], $this->fromBrowser());
		$scrub = $this->proxyFrom('-f lavfi -i testsrc=size=320x180:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -b:v 250k')[0];
		$given = $this->nc->ocs('POST', "/versions/{$version['id']}/scrub", ['fileId' => $scrub]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame([], $this->fromBrowser(), 'nothing is missing');

		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/regenerate")['status']);
		self::assertSame(['thumbs', 'waveform', 'scrub'], $this->fromBrowser(), 'regenerated, it lacks them again');
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => ''])['status']);
		self::assertSame([], $this->fromBrowser(), 'ffmpeg makes them');
	}

	public function testAMasterLacksItsProxyTooAndASilentVideoNoWaveform(): void {
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		self::assertSame(['proxy', 'thumbs', 'waveform', 'scrub'], $this->fromBrowser());
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$version['id']}/proxy/progress", ['percent' => 10])['status']);
		self::assertSame([], $this->fromBrowser(), 'a browser making the Proxy makes the rest in the same pass');

		$this->make('-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libvpx-vp9 -b:v 200k -f webm');
		$this->nc->put("{$this->root}/silent.webm", (string)file_get_contents($this->fixture));
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$silent = array_values(array_filter($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], static fn (array $asset) => $asset['versions'][0]['name'] === 'silent.webm'))[0]['versions'][0]['id'];
		self::assertSame(['thumbs', 'scrub'], $this->fromBrowser($silent), 'no sound, no Waveform');
	}

	public function testAThumbnailStripTheServerMakesWins(): void {
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => ''])['status']);
		$this->make(self::PRORES);
		$version = $this->upload('master.mov');
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/thumbs", ['image' => $this->image('320x90'), 'every' => 1, 'count' => 2])['status'], 'ffmpeg queued its own');
	}

	/** Runs PHP inside this Nextcloud, for what no API does: the minutes passing */
	private function inNextcloud(string $code): string {
		exec('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; ' . $code) . ' 2>&1', $output, $status);
		self::assertSame(0, $status, implode("\n", $output));
		return implode("\n", $output);
	}

	public function testAWebmKeepsItsFrameRate(): void {
		$this->make('-f lavfi -i testsrc=size=320x180:rate=24000/1001:duration=2 -f lavfi -i sine=duration=2 -c:v libvpx-vp9 -c:a libopus -shortest -f webm');
		$version = $this->upload('cut.webm');

		self::assertSame(['num' => 24000, 'den' => 1001], $version['fps']);
		self::assertSame(48, $version['durationFrames']);
		self::assertSame([320, 180], [$version['width'], $version['height']]);
		self::assertFalse($version['audioOnly']);
		self::assertTrue($version['playable']);
	}

	public function testAnMkvKeepsItsFrameRateAndLeavesPlayingToTheBrowser(): void {
		$this->make('-f lavfi -i testsrc=size=320x180:rate=50:duration=1 -c:v libx264 -pix_fmt yuv420p -f matroska');
		$version = $this->upload('cut.mkv');

		self::assertSame(['num' => 50, 'den' => 1], $version['fps']);
		self::assertSame(50, $version['durationFrames']);
		// Chrome and Firefox play H.264 in Matroska, Safari does not and says so
		self::assertTrue($version['playable']);
		self::assertNull($version['derived']['error']);
	}

	public function testAFormatItCannotReadSaysThatFfmpegIsMissing(): void {
		$this->make('-f lavfi -i testsrc=size=320x180:rate=25:duration=1 -c:v mpeg4 -f avi');
		$version = $this->upload('cut.avi');

		self::assertSame('Without ffmpeg, Deliver cannot read this format', $version['derived']['error']);
	}

	public function testAWaveformFromTheBrowserIsChecked(): void {
		$this->make('-f lavfi -i sine=duration=1 -c:a libmp3lame -f mp3');
		$id = $this->upload('take.mp3')['id'];

		foreach ([
			'louder than full scale' => ['peaks' => [1.5], 'durationFrames' => 1000],
			'more peaks than a Waveform has' => ['peaks' => array_fill(0, 2001, 0.1), 'durationFrames' => 1000],
			'no peaks' => ['peaks' => [], 'durationFrames' => 1000],
			'no duration' => ['peaks' => [0.1], 'durationFrames' => 0],
		] as $case => $body) {
			self::assertSame(400, $this->nc->ocs('POST', "/versions/$id/waveform", $body)['status'], $case);
		}
	}

	#[DataProvider('pcm')]
	public function testAWavOfAnyPcmGetsItsWaveform(string $codec, bool $playable): void {
		$this->make("-f lavfi -i sine=duration=1 -ar 48000 -ac 2 -c:a $codec -f wav");
		$version = $this->upload('mix.wav');

		$peaks = json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true)['peaks'];
		// Spread over two channels, the sine at an eighth of full scale comes to 0.088
		self::assertEqualsWithDelta(0.088, max($peaks), 0.01);
		self::assertEqualsWithDelta(0.088, $peaks[1000], 0.01, 'every bucket of a steady sine peaks alike');
		self::assertSame($playable, $version['playable']);
	}

	/** @return array<string, array{string, bool}> codec, and whether browsers play it (64-bit float is beyond them) */
	public static function pcm(): array {
		return [
			'8 bit' => ['pcm_u8', true],
			'24 bit' => ['pcm_s24le', true],
			'32 bit' => ['pcm_s32le', true],
			'32 bit float' => ['pcm_f32le', true],
			'64 bit float' => ['pcm_f64le', false],
		];
	}
}
