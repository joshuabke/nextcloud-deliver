<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\Timecode;
use PHPUnit\Framework\TestCase;

/** The same cases as src/lib/timecode.spec.js, so server and client count alike */
class TimecodeTest extends TestCase {
	public function testWholeFramesPerTimecodeSecond(): void {
		self::assertSame('00:00:00:00', Timecode::format(0, 25, 1));
		self::assertSame('00:00:00:24', Timecode::format(24, 25, 1));
		self::assertSame('00:01:00:00', Timecode::format(1500, 25, 1));
		self::assertSame('00:00:01:00', Timecode::format(24, 24000, 1001), '23.976 counts 24 per timecode second');
		self::assertSame('01:00:09:22', Timecode::format(90247, 25, 1));
	}

	public function testDropFrameSkipsNumbersExceptEveryTenthMinute(): void {
		self::assertSame('00:00:59;28', Timecode::format(1798, 30000, 1001, true));
		self::assertSame('00:01:00;02', Timecode::format(1800, 30000, 1001, true));
		self::assertSame('00:10:00;00', Timecode::format(17982, 30000, 1001, true));
	}

	public function testReadingIsTheInverse(): void {
		self::assertSame(90247, Timecode::toFrames('01:00:09:22', 25, 1));
		self::assertSame(1800, Timecode::toFrames('00:01:00;02', 30000, 1001));
		self::assertSame(17982, Timecode::toFrames('00:10:00;00', 30000, 1001));
		self::assertSame(0, Timecode::toFrames('not a timecode', 25, 1));
	}
}
