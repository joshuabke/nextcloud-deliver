<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Audio a browser plays by itself is played as it is: there is no audio
 * Proxy, so a file wrongly taken for unplayable would stay silent.
 */
class AudioPlaysTest extends TestCase {
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
		$this->fixture = sys_get_temp_dir() . '/deliver-audio-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	/** @return array<string, array{0: string, 1: string, 2: bool}> file name, ffmpeg output options, whether browsers play it */
	public static function files(): array {
		return [
			'MP3' => ['song.mp3', '-c:a libmp3lame -f mp3', true],
			'WAV' => ['mix.wav', '-c:a pcm_s24le -f wav', true],
			'FLAC' => ['mix.flac', '-c:a flac -f flac', true],
			'Ogg Vorbis' => ['mix.ogg', '-c:a libvorbis -f ogg', true],
			'Ogg Opus' => ['mix.opus', '-c:a libopus -f ogg', true],
			'AAC' => ['mix.aac', '-c:a aac -f adts', true],
		];
	}

	#[DataProvider('files')]
	public function testAudioIsPlayableWhereBrowsersPlayIt(string $name, string $options, bool $playable): void {
		exec("ffmpeg -v error -y -f lavfi -i sine=duration=1 -ar 48000 $options " . escapeshellarg($this->fixture) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		$this->nc->put("{$this->root}/$name", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);

		$version = $this->nc->ocs('GET', "/versions/$versionId")['data']['versions'][0];
		self::assertTrue($version['audioOnly']);
		self::assertSame(['num' => 1000, 'den' => 1], $version['fps'], 'audio counts in milliseconds');
		self::assertSame($playable, $version['playable']);
		self::assertTrue($version['wavExport'], 'ffmpeg turns any audio into WAV');
	}
}
