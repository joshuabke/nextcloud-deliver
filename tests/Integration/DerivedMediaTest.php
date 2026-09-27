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
		$this->nc->ocs('PUT', '/admin/settings', ['hwEncoder' => 'none', 'hwDevice' => '', 'extraArgs' => '', 'maxHeight' => 1080]);
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
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

		$waveform = json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true);
		self::assertNotEmpty($waveform['peaks']);
		foreach ($waveform['peaks'] as $peak) {
			self::assertGreaterThanOrEqual(0, $peak);
			self::assertLessThanOrEqual(1, $peak);
		}
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

		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		try {
			self::assertSame(403, $this->nc->withUser($user, $password)->ocs('GET', '/admin/settings')['status']);
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
	}

	public function testALargeOriginalStaysTheDefaultAndGetsALighterProxy(): void {
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['maxHeight' => 144])['status']);
		// Portrait H.264 at 180x320: browsers play it, but its short side is above the limit
		[$code, $output] = $this->shell(sprintf(
			'ffmpeg -loglevel error -y -f lavfi -i testsrc=size=180x320:rate=25:duration=1 '
			. '-f lavfi -i sine=frequency=440:duration=1 -c:v libx264 -pix_fmt yuv420p -c:a aac -f mp4 %s',
			escapeshellarg($this->fixture),
		));
		self::assertSame(0, $code, $output);
		$this->nc->put("{$this->root}/portrait.mp4", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->drainQueue();

		$version = $this->version($versionId);
		self::assertTrue($version['playable'], 'the original plays as it is');
		self::assertNotNull($version['url']);
		self::assertSame(180, $version['resolution']);
		self::assertSame('ready', $version['derived']['proxy']['state'], (string)$version['derived']['error']);
		self::assertSame(144, $version['derived']['proxy']['resolution']);

		$proxy = $this->nc->request('GET', $version['derived']['proxy']['url']);
		$copy = sys_get_temp_dir() . '/deliver-proxy-' . bin2hex(random_bytes(4)) . '.mp4';
		file_put_contents($copy, $proxy['body']);
		[, $probed] = $this->shell('ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ' . escapeshellarg($copy));
		@unlink($copy);
		self::assertSame('144,256', trim($probed), 'the limit applies to the short side, so portrait stays portrait');
	}
}
