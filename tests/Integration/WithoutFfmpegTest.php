<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

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

		self::assertSame(['num' => 25, 'den' => 1], $version['fps'], 'audio takes the Project frame rate');
		self::assertSame(90000, $version['startFrame']);
		self::assertSame(100, $version['durationFrames']);
		self::assertTrue($version['playable'], 'a WAV plays in the browser as it is');
	}
}
