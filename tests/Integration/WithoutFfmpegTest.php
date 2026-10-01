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
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
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

	/** @return array<string, array{string, string}> */
	public static function audio(): array {
		return [
			'MP3' => ['-c:a libmp3lame -f mp3', 'take.mp3'],
			'MP3 with an ID3 tag' => ['-c:a libmp3lame -metadata title=Take -id3v2_version 3 -f mp3', 'tagged.mp3'],
			'FLAC' => ['-c:a flac -f flac', 'take.flac'],
			'Ogg Vorbis' => ['-c:a libvorbis -f ogg', 'take.ogg'],
			'Ogg Opus' => ['-c:a libopus -f ogg', 'take.opus'],
			'AAC' => ['-c:a aac -f adts', 'take.aac'],
		];
	}

	#[DataProvider('audio')]
	public function testAudioIsKnownAsAudio(string $args, string $name): void {
		$this->make("-f lavfi -i sine=duration=2 -ar 48000 $args");
		$version = $this->upload($name);

		self::assertTrue($version['audioOnly']);
		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertTrue($version['playable']);
		self::assertNull($version['derived']['error'], 'nothing failed');
		self::assertFalse($version['wavExport'], 'turning it into WAV needs ffmpeg');

		// The browser decodes it and hands in what the server cannot work out
		self::assertSame('none', $version['derived']['waveform']['state']);
		self::assertNull($version['durationFrames']);
		$given = $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.1, 0.5, 0.25], 'durationFrames' => 2000]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		$version = $this->nc->ocs('GET', "/versions/{$version['id']}")['data']['versions'][0];
		self::assertSame('ready', $version['derived']['waveform']['state']);
		self::assertSame(2000, $version['durationFrames']);
		self::assertSame([0.1, 0.5, 0.25], json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true)['peaks']);
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$version['id']}/waveform", ['peaks' => [0.2], 'durationFrames' => 2000])['status'], 'once is enough');
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
