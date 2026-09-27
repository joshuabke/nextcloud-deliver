<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * SMPTE timecode and Frames, the server's counterpart of src/lib/timecode.js.
 * Fractional rates count whole frames per timecode second (23.976 counts 24),
 * as NLEs do; drop-frame applies at 29.97 and 59.94.
 */
final class Timecode {
	/** `01:00:00:00` at 25 fps is Frame 90000; a semicolon means drop-frame */
	public static function toFrames(string $timecode, int $num, int $den): int {
		if (preg_match('/^(\d+):(\d+):(\d+)[:;](\d+)$/', trim($timecode), $m) !== 1) {
			return 0;
		}
		[, $hours, $minutes, $seconds, $frames] = array_map('intval', $m);
		$nominal = self::nominal($num, $den);
		$total = (($hours * 60 + $minutes) * 60 + $seconds) * $nominal + $frames;
		if (str_contains($timecode, ';') && self::drops($nominal)) {
			$totalMinutes = $hours * 60 + $minutes;
			$total -= intdiv($nominal, 15) * ($totalMinutes - intdiv($totalMinutes, 10));
		}
		return max(0, $total);
	}

	/** Frame 90000 at 25 fps is `01:00:00:00` */
	public static function format(int $frame, int $num, int $den, bool $dropFrame = false): string {
		$nominal = self::nominal($num, $den);
		$counted = $dropFrame && self::drops($nominal) ? self::withDroppedNumbers($frame, $nominal) : $frame;
		$seconds = intdiv($counted, $nominal);
		return sprintf(
			'%02d:%02d:%02d%s%02d',
			intdiv($seconds, 3600),
			intdiv($seconds, 60) % 60,
			$seconds % 60,
			$dropFrame ? ';' : ':',
			$counted % $nominal,
		);
	}

	/** Whole frames per timecode second */
	public static function nominal(int $num, int $den): int {
		return max(1, (int)round($num / max(1, $den)));
	}

	private static function drops(int $nominal): bool {
		return $nominal === 30 || $nominal === 60;
	}

	/** Drop-frame skips two frame numbers (four at 59.94) every minute except every tenth */
	private static function withDroppedNumbers(int $frame, int $nominal): int {
		$dropped = intdiv($nominal, 15);
		$perMinute = $nominal * 60 - $dropped;
		$perTenMinutes = $perMinute * 10 + $dropped;
		$tens = intdiv($frame, $perTenMinutes);
		$rest = $frame % $perTenMinutes;
		$minutes = $rest < $dropped ? 0 : intdiv($rest - $dropped, $perMinute);
		return $frame + $dropped * (9 * $tens + $minutes);
	}
}
