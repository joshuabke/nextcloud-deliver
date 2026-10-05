<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The delivering tool writes a Take's Session Time into the MP3 itself, as an
 * ID3 TXXX frame, and hands in its peaks as the Waveform right after the
 * upload (ADR 0012). Deliver reads the start alike with ffmpeg and without:
 * ffprobe names the frame as a format tag, the container probe parses the
 * tag on its own.
 */
class StartInTheFileTest extends TestCase {
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
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->fixture = sys_get_temp_dir() . '/deliver-tagged-' . bin2hex(random_bytes(4)) . '.mp3';
	}

	protected function tearDown(): void {
		$this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => '']);
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	/** @return array<string, array{bool}> */
	public static function ffmpeg(): array {
		return ['with ffmpeg' => [true], 'without ffmpeg' => [false]];
	}

	/** @return array<string, array{bool, string}> */
	public static function tags(): array {
		$cases = [];
		foreach (self::ffmpeg() as $name => [$ffmpeg]) {
			foreach (['ID3v2.3' => 'v3', 'ID3v2.4' => 'v4', 'UTF-16 at 24 kHz' => 'utf16'] as $tag => $kind) {
				$cases["$tag $name"] = [$ffmpeg, $kind];
			}
		}
		return $cases;
	}

	/**
	 * An MP3 of two seconds. ffmpeg writes ID3v2.3 and v2.4 in ISO-8859-1; the
	 * UTF-16 tag is put together here, as other tools write it, in front of an
	 * MP3 without one.
	 */
	private function make(?string $timeReference, string $kind = 'v4'): void {
		$rate = $kind === 'utf16' ? 24000 : 44100;
		$args = "-f lavfi -i sine=duration=2 -ar $rate -c:a libmp3lame -f mp3";
		if ($kind === 'utf16') {
			$args .= ' -id3v2_version 0';
		} else {
			$args .= ' -id3v2_version ' . ($kind === 'v3' ? 3 : 4);
			if ($timeReference !== null) {
				$args .= ' -metadata ' . escapeshellarg("DELIVER_TIME_REFERENCE=$timeReference");
			}
		}
		exec('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		if ($kind === 'utf16') {
			$utf16 = static fn (string $text) => "\xFF\xFE" . mb_convert_encoding($text, 'UTF-16LE', 'UTF-8');
			$text = "\x01" . $utf16('DELIVER_TIME_REFERENCE') . "\0\0" . $utf16((string)$timeReference);
			$frame = 'TXXX' . pack('N', strlen($text)) . "\0\0" . $text;
			$size = strlen($frame);
			$syncsafe = implode('', array_map(static fn (int $shift) => chr(($size >> $shift) & 0x7F), [21, 14, 7, 0]));
			file_put_contents($this->fixture, "ID3\x03\x00\x00" . $syncsafe . $frame . file_get_contents($this->fixture));
		}
	}

	/** @return int the id of the Version, before its probe ran */
	private function upload(bool $ffmpeg): int {
		$off = ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe'];
		$set = $this->nc->ocs('PUT', '/admin/settings', $ffmpeg ? ['ffmpegPath' => '', 'ffprobePath' => ''] : $off);
		self::assertSame(200, $set['status'], json_encode($set['data']));
		$this->nc->put("{$this->root}/take.mp3", (string)file_get_contents($this->fixture));
		return $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
	}

	/** @return array<string, mixed> the Version after its jobs ran */
	private function processed(int $versionId): array {
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$shown = $this->nc->ocs('GET', "/versions/$versionId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['versions'][0];
	}

	#[DataProvider('tags')]
	public function testTheStartIsInTheFile(bool $ffmpeg, string $kind): void {
		// 4:12.350 into the session, in samples since midnight at the file's own rate
		$rate = $kind === 'utf16' ? 24000 : 44100;
		$this->make((string)(252350 * $rate / 1000), $kind);
		$version = $this->processed($this->upload($ffmpeg));

		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertSame(252350, $version['startFrame']);
		self::assertNull($version['derived']['error']);
	}

	/** @return array<string, array{bool, string}> */
	public static function malformed(): array {
		$cases = [];
		foreach (self::ffmpeg() as $name => [$ffmpeg]) {
			$cases["not a number $name"] = [$ffmpeg, 'noon'];
			$cases["negative $name"] = [$ffmpeg, '-48000'];
			$cases["beyond any day $name"] = [$ffmpeg, str_repeat('9', 30)];
			// Beyond what a TXXX frame may hold
			$cases["oversized $name"] = [$ffmpeg, '1' . str_repeat(' ', 5000)];
		}
		return $cases;
	}

	#[DataProvider('malformed')]
	public function testAMalformedTimeReferenceIsIgnored(bool $ffmpeg, string $timeReference): void {
		$this->make($timeReference);
		$version = $this->processed($this->upload($ffmpeg));

		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertSame(0, $version['startFrame']);
		self::assertNull($version['derived']['error']);
	}

	#[DataProvider('ffmpeg')]
	public function testTheToolHandsInItsWaveformBeforeTheProbeRan(bool $ffmpeg): void {
		$this->make(null);
		$id = $this->upload($ffmpeg);
		$given = $this->nc->ocs('POST', "/versions/$id/waveform", ['peaks' => [0.1, 0.5, 1], 'durationFrames' => 2000]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/waveform", ['peaks' => [0.2], 'durationFrames' => 2000])['status'], 'once is enough');

		$version = $this->processed($id);
		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertSame('ready', $version['derived']['waveform']['state']);
		$peaks = json_decode($this->nc->request('GET', $version['derived']['waveform']['url'])['body'], true)['peaks'];
		if ($ffmpeg) {
			self::assertCount(2000, $peaks, 'the server makes its own, which replaces the one handed in');
		} else {
			self::assertSame([0.1, 0.5, 1], $peaks);
			self::assertSame(2000, $version['durationFrames'], 'milliseconds, as audio counts');
		}
	}
}
