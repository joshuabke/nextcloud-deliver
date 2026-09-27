<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * Marker files for audio workstations, from the markers ExportService
 * collects. Positions are seconds derived from Frames here and nowhere else;
 * nothing of it is stored.
 */
final class DawMarkers {
	/** Ticks per quarter note of the MIDI marker file */
	private const PPQ = 960;
	/** 120 BPM, so a second is exactly two quarter notes */
	private const MICROSECONDS_PER_QUARTER = 500000;

	/**
	 * Seconds from the session start to a Frame of the Version.
	 *
	 * @param array{num: int, den: int, start: int} $clip
	 */
	public static function seconds(array $clip, int $frame): float {
		return ($clip['start'] + $frame) * $clip['den'] / $clip['num'];
	}

	/**
	 * A Standard MIDI File (format 0) holding only a tempo of 120 BPM and one
	 * marker meta event per Comment. A Range becomes two markers, its start
	 * and its end, since MIDI markers have no length.
	 */
	public static function midi(array $clip, array $markers): string {
		$events = [];
		foreach ($markers as $marker) {
			$events[] = [self::ticks(self::seconds($clip, $marker['in'])), ExportService::note($marker)];
			if ($marker['out'] !== null) {
				$events[] = [self::ticks(self::seconds($clip, $marker['out'] + 1)), 'End: ' . ExportService::note($marker)];
			}
		}
		usort($events, static fn (array $a, array $b) => $a[0] <=> $b[0]);

		// Track name, then the tempo as three bytes of microseconds per quarter note
		$track = self::meta(0, 0x03, $clip['title'])
			. self::meta(0, 0x51, substr(pack('N', self::MICROSECONDS_PER_QUARTER), 1));
		$previous = 0;
		foreach ($events as [$tick, $text]) {
			$track .= self::meta($tick - $previous, 0x06, $text);
			$previous = $tick;
		}
		$track .= self::meta(0, 0x2F, '');

		// Header: length 6, format 0, one track, ticks per quarter note
		return 'MThd' . pack('Nnnn', 6, 0, 1, self::PPQ)
			. 'MTrk' . pack('N', strlen($track)) . $track;
	}

	private static function ticks(float $seconds): int {
		return (int)round($seconds * 1e6 / self::MICROSECONDS_PER_QUARTER * self::PPQ);
	}

	/** A meta event after a delta time, both in MIDI's variable-length encoding */
	private static function meta(int $delta, int $type, string $data): string {
		return self::varLength($delta) . chr(0xFF) . chr($type) . self::varLength(strlen($data)) . $data;
	}

	private static function varLength(int $value): string {
		$bytes = chr($value & 0x7F);
		while (($value >>= 7) > 0) {
			$bytes = chr(($value & 0x7F) | 0x80) . $bytes;
		}
		return $bytes;
	}

	/**
	 * REAPER's Region/Marker Manager CSV: `M` rows are markers, `R` rows are
	 * regions, times as hours:minutes:seconds with milliseconds.
	 */
	public static function reaper(array $clip, array $markers): string {
		$time = static fn (float $seconds) => sprintf(
			'%d:%02d:%06.3f',
			intdiv((int)$seconds, 3600),
			intdiv((int)$seconds, 60) % 60,
			fmod($seconds, 60),
		);
		$handle = fopen('php://temp', 'r+');
		fputcsv($handle, ['#', 'Name', 'Start', 'End', 'Length'], ',', '"', '');
		$counts = ['M' => 0, 'R' => 0];
		foreach ($markers as $marker) {
			$start = self::seconds($clip, $marker['in']);
			$type = $marker['out'] === null ? 'M' : 'R';
			$counts[$type]++;
			$end = $marker['out'] === null ? null : self::seconds($clip, $marker['out'] + 1);
			fputcsv($handle, [
				$type . $counts[$type],
				ExportService::note($marker),
				$time($start),
				$end === null ? '' : $time($end),
				$end === null ? '' : $time($end - $start),
			], ',', '"', '');
		}
		rewind($handle);
		$csv = (string)stream_get_contents($handle);
		fclose($handle);
		return $csv;
	}

	/**
	 * RIFF chunks that put the markers into a WAV file: a `cue ` chunk with
	 * one cue point per marker, and a `LIST`/`adtl` chunk with their labels
	 * and, for Ranges, their length. Positions are samples from the start of
	 * the file, so the file's own place in the session (BWF) still applies.
	 *
	 * @param list<array<string, mixed>> $markers
	 */
	public static function wavChunks(array $clip, array $markers, int $sampleRate): string {
		$sample = static fn (int $frame) => (int)round($frame * $clip['den'] / $clip['num'] * $sampleRate);
		$cues = '';
		$labels = '';
		foreach ($markers as $index => $marker) {
			$id = $index + 1;
			$position = $sample($marker['in']);
			$cues .= pack('VV', $id, $position) . 'data' . pack('VVV', 0, 0, $position);
			$labels .= self::chunk('labl', pack('V', $id) . ExportService::note($marker) . "\0");
			if ($marker['out'] !== null) {
				$length = $sample($marker['out'] + 1) - $position;
				$labels .= self::chunk('ltxt', pack('VV', $id, $length) . 'rgn ' . pack('vvvv', 0, 0, 0, 0));
			}
		}
		return self::chunk('cue ', pack('V', count($markers)) . $cues) . self::chunk('LIST', 'adtl' . $labels);
	}

	/** A RIFF chunk, padded to an even length as RIFF requires */
	private static function chunk(string $id, string $data): string {
		return $id . pack('V', strlen($data)) . $data . (strlen($data) % 2 === 1 ? "\0" : '');
	}

	/**
	 * Adds the Comments as locators to an Ableton Live Set. Live imports no
	 * marker files, and it opens only sets its own version wrote, so the
	 * person hands in one of theirs and gets it back with locators. Live
	 * counts locators in beats, converted at the set's tempo.
	 *
	 * @param string $set the .als file, gzip-compressed XML
	 * @return string the same set with the locators added, compressed again
	 * @throws InvalidRequestException the upload is no Live Set Deliver can read
	 */
	public static function ableton(string $set, array $clip, array $markers): string {
		$xml = @gzdecode($set);
		if ($xml === false || !str_contains($xml, '<LiveSet')) {
			throw new InvalidRequestException('This is not an Ableton Live Set (.als)');
		}
		if (preg_match('/<Tempo>.*?<Manual Value="([\d.]+)"/s', $xml, $tempo) !== 1) {
			throw new InvalidRequestException('The Live Set has no tempo Deliver could find');
		}
		$beatsPerSecond = (float)$tempo[1] / 60;

		preg_match_all('/<Locator Id="(\d+)"/', $xml, $ids);
		$nextId = $ids[1] === [] ? 0 : max(array_map('intval', $ids[1])) + 1;
		$locators = '';
		foreach ($markers as $marker) {
			$locators .= sprintf(
				'<Locator Id="%d"><LomId Value="0" /><Time Value="%s" /><Name Value="%s" /><Annotation Value="" /><IsSongStart Value="false" /></Locator>',
				$nextId++,
				rtrim(rtrim(sprintf('%.6F', self::seconds($clip, $marker['in']) * $beatsPerSecond), '0'), '.'),
				htmlspecialchars(ExportService::note($marker), ENT_XML1 | ENT_QUOTES, 'UTF-8'),
			);
		}

		// The set's own list is <Locators><Locators /></Locators> when empty
		$count = 0;
		$xml = preg_replace_callback(
			'#<Locators>(\s*)<Locators\s*/>(\s*)</Locators>|<Locators>(\s*)<Locators>(.*?)</Locators>(\s*)</Locators>#s',
			static function (array $m) use ($locators): string {
				return isset($m[4])
					? "<Locators>{$m[3]}<Locators>{$m[4]}{$locators}</Locators>{$m[5]}</Locators>"
					: "<Locators>{$m[1]}<Locators>{$locators}</Locators>{$m[2]}</Locators>";
			},
			$xml,
			1,
			$count,
		);
		if ($count !== 1) {
			throw new InvalidRequestException('The Live Set has no locator list Deliver could find');
		}
		return (string)gzencode($xml);
	}
}
