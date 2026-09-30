<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * What Frames rest on, read without ffprobe (ADR 0003): the frame rate, the
 * start timecode and the duration of a MOV or MP4 from its boxes, and the
 * time reference of a Broadcast WAV. The answer has ffprobe's shape, so
 * Probe treats both alike. Other containers (WebM, MXF, MP3) stay unread
 * and take the Project's frame rate. Only headers are read: the media data
 * is skipped by seeking, so a file of many gigabytes costs a few reads.
 */
class ContainerProbe {
	/** ffprobe's names for the sample entries a browser may meet */
	private const CODECS = [
		'avc1' => 'h264', 'avc3' => 'h264', 'hvc1' => 'hevc', 'hev1' => 'hevc', 'av01' => 'av1', 'vp09' => 'vp9',
		'mp4a' => 'aac', '.mp3' => 'mp3', 'Opus' => 'opus',
		'apco' => 'prores', 'apcs' => 'prores', 'apcn' => 'prores', 'apch' => 'prores', 'ap4h' => 'prores', 'ap4x' => 'prores',
	];
	/** H.264 profiles that are 8-bit 4:2:0, the only kind browsers decode */
	private const H264_420 = [66, 77, 88, 100];

	/** @var resource */
	private $file;

	/** @return array<string, mixed>|null ffprobe's shape, or null for a container this does not read */
	public function read(string $path): ?array {
		$file = @fopen($path, 'rb');
		if ($file === false) {
			return null;
		}
		$this->file = $file;
		try {
			$head = (string)fread($file, 12);
			if (str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WAVE') {
				return $this->wav();
			}
			if (in_array(substr($head, 4, 4), ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'], true)) {
				return $this->quickTime();
			}
			return null;
		} finally {
			fclose($file);
		}
	}

	/** @return array<string, mixed>|null */
	private function quickTime(): ?array {
		$moov = $this->child(0, $this->size(), 'moov');
		if ($moov === null) {
			return null;
		}
		$streams = [];
		$tags = [];
		$seconds = 0.0;
		foreach ($this->boxes($moov[0], $moov[1]) as [$type, $start, $end]) {
			if ($type !== 'trak') {
				continue;
			}
			$track = $this->track($start, $end);
			if ($track === null) {
				continue;
			}
			$seconds = max($seconds, $track['seconds']);
			if ($track['timecode'] !== null) {
				$tags['timecode'] ??= $track['timecode'];
			} elseif ($track['stream'] !== null) {
				$streams[] = $track['stream'];
			}
		}
		return [
			'format' => ['format_name' => 'mov,mp4,m4a,3gp,3g2,mj2', 'duration' => (string)$seconds, 'tags' => $tags],
			'streams' => $streams,
		];
	}

	/** @return array{seconds: float, stream: ?array<string, mixed>, timecode: ?string}|null */
	private function track(int $start, int $end): ?array {
		$mdia = $this->child($start, $end, 'mdia');
		$mdhd = $mdia === null ? null : $this->child($mdia[0], $mdia[1], 'mdhd');
		$hdlr = $mdia === null ? null : $this->child($mdia[0], $mdia[1], 'hdlr');
		$minf = $mdia === null ? null : $this->child($mdia[0], $mdia[1], 'minf');
		$stbl = $minf === null ? null : $this->child($minf[0], $minf[1], 'stbl');
		if ($mdhd === null || $hdlr === null || $stbl === null) {
			return null;
		}
		$version = ord($this->at($mdhd[0], 1));
		[$timescale, $duration] = $version === 1
			? [$this->u32($mdhd[0] + 20), $this->u64($mdhd[0] + 24)]
			: [$this->u32($mdhd[0] + 12), $this->u32($mdhd[0] + 16)];
		if ($timescale === 0) {
			return null;
		}
		$handler = $this->at($hdlr[0] + 8, 4);
		$entry = $this->child($stbl[0], $stbl[1], 'stsd');
		$format = $entry === null ? '' : $this->at($entry[0] + 12, 4);
		$track = ['seconds' => $duration / $timescale, 'stream' => null, 'timecode' => null];

		if ($handler === 'tmcd' && $format === 'tmcd' && $entry !== null) {
			$track['timecode'] = $this->timecode($entry[0] + 8, $stbl);
		} elseif ($handler === 'vide' && $entry !== null) {
			$stream = [
				'codec_type' => 'video',
				'codec_name' => self::CODECS[$format] ?? strtolower($format),
				'width' => $this->u16($entry[0] + 8 + 32),
				'height' => $this->u16($entry[0] + 8 + 34),
			];
			$rate = $this->frameRate($stbl, $timescale);
			if ($rate !== null) {
				$stream['avg_frame_rate'] = $rate;
			}
			if ($stream['codec_name'] === 'h264') {
				// The first byte after avcC's version is the profile
				$avcC = $this->child($entry[0] + 8 + 86, min($entry[1], $entry[0] + 8 + $this->u32($entry[0] + 8)), 'avcC');
				$profile = $avcC === null ? 0 : ord($this->at($avcC[0] + 1, 1));
				$stream['pix_fmt'] = in_array($profile, self::H264_420, true) ? 'yuv420p' : 'unknown';
			}
			$track['stream'] = $stream;
		} elseif ($handler === 'soun' && $entry !== null) {
			$track['stream'] = ['codec_type' => 'audio', 'codec_name' => self::CODECS[$format] ?? strtolower($format)];
		}
		return $track;
	}

	/** Frames over time, as ffprobe's avg_frame_rate: 24000/1001 stays a fraction */
	private function frameRate(array $stbl, int $timescale): ?string {
		$stts = $this->child($stbl[0], $stbl[1], 'stts');
		if ($stts === null) {
			return null;
		}
		$frames = 0;
		$ticks = 0;
		$entries = min($this->u32($stts[0] + 4), intdiv($stts[1] - $stts[0] - 8, 8));
		for ($i = 0; $i < $entries; $i++) {
			$count = $this->u32($stts[0] + 8 + $i * 8);
			$frames += $count;
			$ticks += $count * $this->u32($stts[0] + 12 + $i * 8);
		}
		if ($frames === 0 || $ticks === 0) {
			return null;
		}
		$num = $frames * $timescale;
		$gcd = $this->gcd($num, $ticks);
		return intdiv($num, $gcd) . '/' . intdiv($ticks, $gcd);
	}

	/**
	 * A timecode track holds its start as a frame number in its first sample;
	 * the sample entry says at which rate it counts and whether it drops frames.
	 */
	private function timecode(int $entry, array $stbl): ?string {
		// Size, format, six reserved bytes, the data reference index and four more reserved
		$flags = $this->u32($entry + 20);
		$timescale = $this->u32($entry + 24);
		$frameDuration = $this->u32($entry + 28);
		$offsets = $this->child($stbl[0], $stbl[1], 'stco');
		$wide = $offsets === null;
		$offsets ??= $this->child($stbl[0], $stbl[1], 'co64');
		if ($offsets === null || $timescale === 0 || $frameDuration === 0 || $this->u32($offsets[0] + 4) === 0) {
			return null;
		}
		$sample = $wide ? $this->u64($offsets[0] + 8) : $this->u32($offsets[0] + 8);
		return Timecode::format($this->u32($sample), $timescale, $frameDuration, ($flags & 1) === 1);
	}

	/** @return array<string, mixed>|null */
	private function wav(): ?array {
		$size = $this->size();
		$pos = 12;
		$sampleRate = 0;
		$byteRate = 0;
		$data = 0;
		$reference = null;
		while ($pos + 8 <= $size) {
			$id = $this->at($pos, 4);
			$length = (int)unpack('V', $this->at($pos + 4, 4))[1];
			if ($id === 'fmt ') {
				$sampleRate = (int)unpack('V', $this->at($pos + 12, 4))[1];
				$byteRate = (int)unpack('V', $this->at($pos + 16, 4))[1];
			} elseif ($id === 'bext' && $length >= 346) {
				// After description, originator, its reference, date and time: samples since midnight
				['low' => $low, 'high' => $high] = unpack('Vlow/Vhigh', $this->at($pos + 8 + 338, 8));
				$reference = $high * 4294967296 + $low;
			} elseif ($id === 'data') {
				$data = $length;
			}
			$pos += 8 + $length + ($length & 1);
		}
		if ($sampleRate === 0 || $byteRate === 0) {
			return null;
		}
		return [
			'format' => ['format_name' => 'wav', 'duration' => (string)($data / $byteRate), 'tags' => $reference === null ? [] : ['time_reference' => (string)$reference]],
			'streams' => [['codec_type' => 'audio', 'codec_name' => 'pcm', 'sample_rate' => (string)$sampleRate]],
		];
	}

	/** @return \Generator<array{0: string, 1: int, 2: int}> type, start and end of each box's content */
	private function boxes(int $start, int $end): \Generator {
		$pos = $start;
		while ($pos + 8 <= $end) {
			$size = $this->u32($pos);
			$type = $this->at($pos + 4, 4);
			$content = $pos + 8;
			if ($size === 1) {
				$size = $this->u64($pos + 8);
				$content = $pos + 16;
			} elseif ($size === 0) {
				$size = $end - $pos;
			}
			if ($size < $content - $pos) {
				return;
			}
			yield [$type, $content, min($pos + $size, $end)];
			$pos += $size;
		}
	}

	/** @return array{0: int, 1: int}|null the content of the first child box of a type */
	private function child(int $start, int $end, string $type): ?array {
		foreach ($this->boxes($start, $end) as [$found, $from, $to]) {
			if ($found === $type) {
				return [$from, $to];
			}
		}
		return null;
	}

	private function at(int $offset, int $length): string {
		fseek($this->file, $offset);
		return str_pad((string)fread($this->file, $length), $length, "\0");
	}

	private function u16(int $offset): int {
		return (int)unpack('n', $this->at($offset, 2))[1];
	}

	private function u32(int $offset): int {
		return (int)unpack('N', $this->at($offset, 4))[1];
	}

	private function u64(int $offset): int {
		return (int)unpack('J', $this->at($offset, 8))[1];
	}

	private function size(): int {
		return (int)(fstat($this->file)['size'] ?? 0);
	}

	private function gcd(int $a, int $b): int {
		return $b === 0 ? $a : $this->gcd($b, $a % $b);
	}
}
