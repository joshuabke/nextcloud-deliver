<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\DerivedMedia;
use PHPUnit\Framework\TestCase;

/** The arithmetic of the derived-media pipeline, without ffmpeg */
class DerivedMediaTest extends TestCase {
	public function testExtraArgumentsSplitLikeAShell(): void {
		self::assertSame([], DerivedMedia::splitArgs('  '));
		self::assertSame(['-threads', '4'], DerivedMedia::splitArgs('-threads 4'));
		self::assertSame(['-metadata', 'title=Deliver test', '-x', 'a b'], DerivedMedia::splitArgs('-metadata title="Deliver test" -x \'a b\''));
	}

	public function testProgressStaysBelowAHundredUntilTheJobIsDone(): void {
		self::assertSame(0, DerivedMedia::percent(0, 10.0));
		self::assertSame(50, DerivedMedia::percent(5_000_000, 10.0));
		self::assertSame(99, DerivedMedia::percent(12_000_000, 10.0));
		self::assertSame(0, DerivedMedia::percent(5_000_000, 0.0), 'an unknown length shows no number');
	}

	public function testPeaksAreTheLoudestSampleOfEachBucket(): void {
		$pcm = tempnam(sys_get_temp_dir(), 'deliver-pcm-');
		file_put_contents($pcm, pack('s*', 0, 100, -32767, 5, 16384, -2, 0, 0));
		try {
			self::assertSame([1.0, 0.5], DerivedMedia::peaks($pcm, 2), 'eight samples in two buckets of four');
		} finally {
			unlink($pcm);
		}
	}
}
