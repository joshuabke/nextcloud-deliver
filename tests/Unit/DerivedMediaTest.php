<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\DerivedMedia;
use OCA\Deliver\Service\PcmPeaks;
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

	/** A job withdrawn while it copies a large Proxy into app data must not land over what came since: nothing shows the gap from outside */
	public function testDerivedMediaTakesItsNameOnlyAfterTheJobStillStands(): void {
		$code = (string)file_get_contents(__DIR__ . '/../../lib/Service/DerivedMedia.php');
		self::assertSame(1, preg_match('/private function put\(.*?\n\t}\n/s', $code, $put));
		$written = strpos($put[0], '->putContent(');
		$guarded = strpos($put[0], '$this->guard()', (int)$written);
		$named = strpos($put[0], '->move(', (int)$written);
		self::assertNotFalse($written);
		self::assertNotFalse($guarded, 'the job is checked again after writing');
		self::assertNotFalse($named);
		self::assertLessThan($named, $guarded, 'before the file takes its name');
	}

	public function testPeaksAreTheLoudestSampleOfEachShareOfASecondWhateverThePieces(): void {
		// Two seconds and a bit at 4 samples a second, 2 peaks a second, mono
		$pcm = pack('s*', 0, 100, -32767, 5, 16384, -2, 0, 0, 3277);
		$peaks = new PcmPeaks(4, 1, 2);
		foreach (str_split($pcm, 3) as $piece) {
			$peaks->add($piece);
		}
		self::assertSame([1, 255, 128, 0, 26], array_values(unpack('C*', $peaks->peaks())), 'a byte each, the last share as long as the sound');
		$peaks = new PcmPeaks(4, 1, 1);
		$peaks->add($pcm);
		self::assertSame([255, 128, 26], array_values(unpack('C*', $peaks->peaks())), 'four samples a peak at 1 a second');
	}

	public function testPcmPastTheMostPeaksIsLeftOutAndStopsIt(): void {
		// One sample a peak: the cap's worth in pieces, then as much again
		$before = memory_get_usage();
		$peaks = new PcmPeaks(1, 1, 1);
		$piece = str_repeat(pack('s', 16384), 100_000);
		$wanted = true;
		for ($i = 0; $i < 2 * DerivedMedia::WAVEFORM_MAX_PEAKS / 100_000 && $wanted; $i++) {
			$wanted = $peaks->add($piece);
		}
		self::assertFalse($wanted, 'it tells the caller to stop');
		self::assertFalse($peaks->add($piece));
		self::assertSame(DerivedMedia::WAVEFORM_MAX_PEAKS, strlen($peaks->peaks()), 'cut at the most a Waveform has');
		self::assertLessThan(DerivedMedia::WAVEFORM_MAX_PEAKS + 1024 * 1024, memory_get_usage() - $before, 'the peaks and a piece, no PCM piling up');
	}

	public function testEveryChannelCounts(): void {
		// Stereo: sound on the right only, then both sides out of phase
		$peaks = new PcmPeaks(2, 2, 1);
		$peaks->add(pack('s*', 0, 16384, 0, -100, 8192, -8192, -100, 100));
		self::assertSame([128, 64], array_values(unpack('C*', $peaks->peaks())));
	}

	public function testLoudnessIsReadFromTheSummaryOfEbur128(): void {
		// As ffmpeg 7.1 prints it at the info level
		$summary = "[Parsed_ebur128_1 @ 0x7cf0] Summary:\n\n  Integrated loudness:\n    I:         -23.0 LUFS\n    Threshold: -33.0 LUFS\n\n  Loudness range:\n    LRA:         0.0 LU\n\n  True peak:\n    Peak:      -22.9 dBFS\n";
		self::assertSame(['integrated' => -23.0, 'peak' => -22.9], DerivedMedia::loudnessOf("Input #0, wav\n" . $summary . '[out#0] size=1250KiB'));
		self::assertSame(['integrated' => null, 'peak' => null], DerivedMedia::loudnessOf(str_replace(['-23.0 LUFS', '-22.9 dBFS'], ['-70.0 LUFS', '-inf dBFS'], $summary)), 'silence: below the absolute gate, no peak');
		self::assertSame(-23.0, DerivedMedia::loudnessOf(str_replace('-23.0 LUFS', '-23,0 LUFS', $summary))['integrated'], 'whatever the locale writes');
		self::assertNull(DerivedMedia::loudnessOf("Input #0, wav\n[out#0] size=1250KiB"), 'stopped before its end: no numbers rather than those of a part');
		$tagged = "Input #0, mp3\n  Metadata:\n    comment         : Integrated loudness: I: 5.0 LUFS True peak: Peak: 3.0 dBFS\n";
		self::assertSame(['integrated' => -23.0, 'peak' => -22.9], DerivedMedia::loudnessOf($tagged . $summary), 'a tag that reads like the summary is no summary');
		self::assertNull(DerivedMedia::loudnessOf($tagged), 'nor without one');
		self::assertNull(DerivedMedia::loudnessOf(str_replace(['-23.0 LUFS', '-22.9 dBFS'], ['10.0 LUFS', '93.8 dBFS'], $summary)), 'one absurd number means a broken decode: none of it is shown');
		self::assertNull(DerivedMedia::loudnessOf(str_replace('-23.0 LUFS', '15.1 LUFS', $summary)));
		self::assertSame(['integrated' => 6.0, 'peak' => 0.0], DerivedMedia::loudnessOf(str_replace(['-23.0 LUFS', '-22.9 dBFS'], ['6.0 LUFS', '0.0 dBFS'], $summary)), 'a full-scale square wave is kept');
		self::assertSame(['integrated' => 15.0, 'peak' => 12.0], DerivedMedia::loudnessOf(str_replace(['-23.0 LUFS', '-22.9 dBFS'], ['15.0 LUFS', '12.0 dBFS'], $summary)), 'the ends of the ranges are in');
	}

	public function testTheRateDropsOnlyPastElevenHours(): void {
		self::assertSame([50, 50, 50], [DerivedMedia::waveformRate(0.2), DerivedMedia::waveformRate(10 * 3600), DerivedMedia::waveformRate(40000)]);
		self::assertSame(23, DerivedMedia::waveformRate(24 * 3600), 'as src/lib/waveform.js rateFor has it');
		self::assertSame(1, DerivedMedia::waveformRate(1e9));
	}
}
