<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\DerivedMedia;
use PHPUnit\Framework\TestCase;

/**
 * The ranges of loudness the server shows and takes live in DerivedMedia;
 * the browser's meter keeps the same values to leave numbers out of a
 * hand-in the server would refuse whole (A5). No behaviour shows the two
 * apart, so this reads the browser's code and holds it to the server's.
 */
class LoudnessRangesTest extends TestCase {
	public function testTheBrowserKeepsTheServersRanges(): void {
		$code = (string)file_get_contents(__DIR__ . '/../../src/lib/loudness.js');
		self::assertSame(1, preg_match('/export const MOST_LOUDNESS = (-?[\d.]+)/', $code, $most));
		self::assertSame(1, preg_match('/export const PEAK_RANGE = \[(-?[\d.]+), (-?[\d.]+)\]/', $code, $peak));
		$server = static fn (string $name): array => (new \ReflectionClassConstant(DerivedMedia::class, $name))->getValue();
		self::assertSame($server('LOUDNESS_RANGE')[1], (float)$most[1], 'the highest integrated loudness');
		self::assertSame($server('PEAK_RANGE'), [(float)$peak[1], (float)$peak[2]], 'the range of the peak');
	}
}
