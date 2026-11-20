<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\ContainerProbe;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** A WAV's header comes from whoever uploads it, and sizes how its PCM is read for the Waveform */
class WavPeaksTest extends TestCase {
	/** A PCM WAV of this data, its header saying what it is given */
	private static function wav(int $channels, int $sampleRate, int $block, int $bits, string $data): string {
		$fmt = pack('vvVVvv', 1, $channels, $sampleRate, $sampleRate * $block, $block, $bits);
		return 'RIFF' . pack('V', 4 + 8 + strlen($fmt) + 8 + strlen($data)) . 'WAVE'
			. 'fmt ' . pack('V', strlen($fmt)) . $fmt
			. 'data' . pack('V', strlen($data)) . $data;
	}

	private static function peaks(string $wav): ?array {
		$path = tempnam(sys_get_temp_dir(), 'deliver-wav-');
		file_put_contents($path, $wav);
		try {
			return (new ContainerProbe())->wavPeaks($path);
		} finally {
			unlink($path);
		}
	}

	/** @return array<string, array{int, int, int, int}> channels, sample rate, block align, bits */
	public static function nonsense(): array {
		return [
			// One peak over 8 MB of data would once have read and unpacked them in one go
			'a sample rate past any recorder' => [1, 0xFFFFFFFF, 2, 16],
			'no sample rate' => [1, 0, 2, 16],
			'a block that does not fit the channels' => [1, 8000, 4096, 16],
			'no channels' => [0, 8000, 0, 16],
		];
	}

	#[DataProvider('nonsense')]
	public function testAHeaderThatSaysNonsenseIsNotRead(int $channels, int $sampleRate, int $block, int $bits): void {
		$before = memory_get_peak_usage();
		$started = microtime(true);
		self::assertNull(self::peaks(self::wav($channels, $sampleRate, $block, $bits, str_repeat("\x00\x40", 4 * 1024 * 1024))));
		self::assertLessThan(1.0, microtime(true) - $started);
		self::assertLessThan(20 * 1024 * 1024, memory_get_peak_usage() - $before, 'no more than the file itself');
	}

	public function testASensibleOneGivesItsPeaksAtTheRate(): void {
		// A second at 8 kHz, half of full scale
		[$rate, $peaks] = self::peaks(self::wav(1, 8000, 2, 16, str_repeat(pack('v', 16384), 8000)));
		self::assertSame(50, $rate);
		self::assertSame(array_fill(0, 50, 128), array_values(unpack('C*', $peaks)));
	}
}
