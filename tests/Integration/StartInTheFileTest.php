<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The delivering tool writes a Take's Session Time into the file itself, as an
 * MP3's ID3 TXXX frame, a FLAC's Vorbis comment or an M4A's iTunes freeform
 * atom, and hands in its peaks as the Waveform right after the upload
 * (ADR 0012). Deliver reads the start alike with ffmpeg and without: ffprobe
 * names each as a format tag, the container probe parses the tag on its own.
 */
class StartInTheFileTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture = '';

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
			foreach ([
				'ID3v2.3' => 'v3', 'ID3v2.4' => 'v4', 'UTF-16 at 24 kHz' => 'utf16',
				'FLAC' => 'flac', 'FLAC with a lower-case key' => 'flac-lower', 'M4A' => 'm4a',
			] as $tag => $kind) {
				$cases["$tag $name"] = [$ffmpeg, $kind];
			}
		}
		return $cases;
	}

	/**
	 * A file of two seconds. ffmpeg writes ID3v2.3 and v2.4 in ISO-8859-1 and
	 * FLAC's Vorbis comments; the UTF-16 tag is put together here, as other
	 * tools write it, in front of an MP3 without one, and so is the M4A's
	 * freeform atom, which ffmpeg does not write.
	 */
	private function make(?string $timeReference, string $kind = 'v4'): void {
		$rate = $kind === 'utf16' ? 24000 : 44100;
		[$codec, $extension] = match ($kind) {
			'flac', 'flac-lower' => ['-c:a flac -f flac', 'flac'],
			'm4a' => ['-c:a aac -f mp4', 'm4a'],
			default => ['-c:a libmp3lame -f mp3 -id3v2_version ' . ['v3' => 3, 'v4' => 4, 'utf16' => 0][$kind], 'mp3'],
		};
		$this->fixture = sys_get_temp_dir() . '/deliver-tagged-' . bin2hex(random_bytes(4)) . ".$extension";
		$args = "-f lavfi -i sine=duration=2 -ar $rate $codec";
		if ($timeReference !== null && !in_array($kind, ['utf16', 'm4a'], true)) {
			$key = $kind === 'flac-lower' ? 'deliver_time_reference' : 'DELIVER_TIME_REFERENCE';
			$args .= ' -metadata ' . escapeshellarg("$key=$timeReference");
		}
		exec('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		if ($kind === 'm4a' && $timeReference !== null) {
			$this->freeform($timeReference);
		}
		if ($kind === 'utf16') {
			$utf16 = static fn (string $text) => "\xFF\xFE" . mb_convert_encoding($text, 'UTF-16LE', 'UTF-8');
			$text = "\x01" . $utf16('DELIVER_TIME_REFERENCE') . "\0\0" . $utf16((string)$timeReference);
			$frame = 'TXXX' . pack('N', strlen($text)) . "\0\0" . $text;
			$size = strlen($frame);
			$syncsafe = implode('', array_map(static fn (int $shift) => chr(($size >> $shift) & 0x7F), [21, 14, 7, 0]));
			file_put_contents($this->fixture, "ID3\x03\x00\x00" . $syncsafe . $frame . file_get_contents($this->fixture));
		}
	}

	/**
	 * An iTunes freeform atom with the start, put into moov/udta/meta/ilst, as
	 * other tools write it; ffmpeg writes its own tags as QuickTime keys
	 * instead. Each box on the way down grows by the atom.
	 */
	private function freeform(string $value): void {
		$mp4 = (string)file_get_contents($this->fixture);
		$box = static fn (string $type, string $content) => pack('N', 8 + strlen($content)) . $type . $content;
		$atom = $box('----', $box('mean', "\0\0\0\0com.apple.iTunes") . $box('name', "\0\0\0\0DELIVER_TIME_REFERENCE") . $box('data', pack('NN', 1, 0) . $value));
		[$start, $end] = [0, strlen($mp4)];
		// meta is a full box: its children start after version and flags
		foreach (['moov' => 0, 'udta' => 0, 'meta' => 4, 'ilst' => 0] as $type => $skip) {
			for ($pos = $start; substr($mp4, $pos + 4, 4) !== $type; $pos += unpack('N', substr($mp4, $pos, 4))[1]) {
				self::assertLessThan($end - 8, $pos, "ffmpeg wrote no $type");
			}
			// The media data comes first, so no chunk offset moves
			self::assertTrue($type !== 'moov' || strpos($mp4, 'mdat') < $pos, 'moov after mdat');
			$size = unpack('N', substr($mp4, $pos, 4))[1];
			$mp4 = substr_replace($mp4, pack('N', $size + strlen($atom)), $pos, 4);
			[$start, $end] = [$pos + 8 + $skip, $pos + $size];
		}
		file_put_contents($this->fixture, substr_replace($mp4, $atom, $end, 0));
	}

	/** @return int the id of the Version, before its probe ran */
	private function upload(bool $ffmpeg): int {
		$off = ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe'];
		$set = $this->nc->ocs('PUT', '/admin/settings', $ffmpeg ? ['ffmpegPath' => '', 'ffprobePath' => ''] : $off);
		self::assertSame(200, $set['status'], json_encode($set['data']));
		$this->nc->put("{$this->root}/take." . pathinfo($this->fixture, PATHINFO_EXTENSION), (string)file_get_contents($this->fixture));
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
		if (str_starts_with($kind, 'flac')) {
			self::assertSame(2000, $version['durationFrames'], 'a FLAC counts its samples, so its duration is exact');
		}
	}

	/** @return array<string, array{bool, string, string}> */
	public static function malformed(): array {
		$cases = [];
		foreach (self::ffmpeg() as $name => [$ffmpeg]) {
			foreach (['MP3' => 'v4', 'FLAC' => 'flac', 'M4A' => 'm4a'] as $format => $kind) {
				$cases["not a number in $format $name"] = [$ffmpeg, $kind, 'noon'];
				$cases["negative in $format $name"] = [$ffmpeg, $kind, '-48000'];
				$cases["beyond any day in $format $name"] = [$ffmpeg, $kind, str_repeat('9', 30)];
				// Beyond what a tag may hold
				$cases["oversized in $format $name"] = [$ffmpeg, $kind, '1' . str_repeat(' ', 5000)];
			}
		}
		return $cases;
	}

	#[DataProvider('malformed')]
	public function testAMalformedTimeReferenceIsIgnored(bool $ffmpeg, string $kind, string $timeReference): void {
		$this->make($timeReference, $kind);
		$version = $this->processed($this->upload($ffmpeg));

		self::assertSame(['num' => 1000, 'den' => 1], $version['fps']);
		self::assertSame(0, $version['startFrame']);
		self::assertNull($version['derived']['error']);
	}

	#[DataProvider('ffmpeg')]
	public function testTheToolHandsInItsWaveformBeforeTheProbeRan(bool $ffmpeg): void {
		$this->make(null);
		$id = $this->upload($ffmpeg);
		$asset = "/files/{$this->nc->fileId("{$this->root}/take.mp3")}/asset";
		self::assertSame(!$ffmpeg, $this->nc->ocs('GET', $asset)['data']['waveformFromBrowser'], 'the uploading browser decodes it only where the server cannot');
		$given = $this->nc->ocs('POST', "/versions/$id/waveform", ['peaks' => [0.1, 0.5, 1], 'durationFrames' => 2000]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/waveform", ['peaks' => [0.2], 'durationFrames' => 2000])['status'], 'once is enough');
		self::assertFalse($this->nc->ocs('GET', $asset)['data']['waveformFromBrowser'], 'once is enough');

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

	public function testAWavIsNotDecodedInTheBrowser(): void {
		exec('ffmpeg -v error -y -f lavfi -i sine=duration=1 -f wav ' . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe']);
		$this->nc->put("{$this->root}/mix.wav", (string)file_get_contents($this->fixture));

		$asset = $this->nc->ocs('GET', "/files/{$this->nc->fileId("{$this->root}/mix.wav")}/asset")['data'];
		self::assertFalse($asset['waveformFromBrowser'], 'its Waveform comes from its PCM on the server');
	}
}
