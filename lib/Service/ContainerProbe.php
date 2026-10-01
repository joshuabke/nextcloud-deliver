<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * What Frames rest on, read without ffprobe (ADR 0003): the frame rate, the
 * start timecode and the duration of a MOV or MP4 from its boxes, and the
 * time reference of a Broadcast WAV. MP3, AAC, FLAC and Ogg are only known
 * as audio, which counts in milliseconds and needs nothing more; the browser
 * knows their duration. The answer has ffprobe's shape, so Probe treats both
 * alike. Other containers (WebM, MXF) stay unread and take the Project's
 * frame rate. Only headers are read: the media data is skipped by seeking,
 * so a file of many gigabytes costs a few reads.
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
			if (str_starts_with($head, 'fLaC')) {
				return $this->audio('flac', 'flac');
			}
			if (str_starts_with($head, 'OggS')) {
				return $this->ogg();
			}
			return $this->mpeg($head);
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
		$chunks = $this->chunks();
		$fmt = $chunks['fmt '] ?? null;
		$byteRate = $fmt === null ? 0 : $this->u32le($fmt[0] + 8);
		if ($fmt === null || $byteRate === 0) {
			return null;
		}
		// ffprobe's name: integer PCM is unsigned at 8 bits and signed above, float is format 3
		$bits = $this->u16le($fmt[0] + 14);
		$codec = match ($this->formatTag($fmt[0])) {
			1 => $bits === 8 ? 'pcm_u8' : "pcm_s{$bits}le",
			3 => "pcm_f{$bits}le",
			default => 'pcm',
		};
		$tags = [];
		$bext = $chunks['bext'] ?? null;
		if ($bext !== null && $bext[1] >= 346) {
			// After description, originator, its reference, date and time: samples since midnight
			$tags['time_reference'] = (string)($this->u32le($bext[0] + 342) * 4294967296 + $this->u32le($bext[0] + 338));
		}
		return [
			'format' => ['format_name' => 'wav', 'duration' => (string)(($chunks['data'][1] ?? 0) / $byteRate), 'tags' => $tags],
			'streams' => [['codec_type' => 'audio', 'codec_name' => $codec, 'sample_rate' => (string)$this->u32le($fmt[0] + 4)]],
		];
	}

	/**
	 * A Waveform straight from a WAV's PCM: the loudest sample of each bucket
	 * over all channels, as ffmpeg's Waveform has it.
	 *
	 * @return list<float>|null 0 to 1, or null for anything but integer or float PCM
	 */
	public function wavPeaks(string $path, int $buckets): ?array {
		$file = @fopen($path, 'rb');
		if ($file === false) {
			return null;
		}
		$this->file = $file;
		try {
			$head = (string)fread($file, 12);
			if (!str_starts_with($head, 'RIFF') || substr($head, 8, 4) !== 'WAVE') {
				return null;
			}
			$chunks = $this->chunks();
			if (!isset($chunks['fmt '], $chunks['data'])) {
				return null;
			}
			$format = $this->formatTag($chunks['fmt '][0]);
			$bits = $this->u16le($chunks['fmt '][0] + 14);
			// unpack code and full scale per sample format; 24 bits are widened to 32 below
			[$code, $scale] = match ("$format/$bits") {
				'1/8' => ['C*', 128],
				'1/16' => ['s*', 32768],
				'1/24', '1/32' => ['l*', 2147483648],
				'3/32' => ['g*', 1],
				'3/64' => ['e*', 1],
				default => [null, 0],
			};
			if ($code === null) {
				return null;
			}
			$width = intdiv($bits, 8);
			[$start, $length] = $chunks['data'];
			$perBucket = max($width, (int)ceil($length / $buckets / $width) * $width);
			$most = intdiv(512 * 1024, $width) * $width;
			$peaks = [];
			for ($at = 0; $at < $length; $at += $perBucket) {
				// ponytail: at most 512 KiB of each bucket, so a WAV of hours reads in seconds; a click past it can be missed
				$chunk = $this->at($start + $at, min($perBucket, $length - $at, $most));
				if ($bits === 24) {
					$chunk = (string)preg_replace('/(...)/s', "\0$1", $chunk);
				}
				$samples = unpack($code, $chunk) ?: [0];
				$loudest = $bits === 8 ? max(max($samples) - 128, 128 - min($samples)) : max(abs(max($samples)), abs(min($samples)));
				$peaks[] = round(min(1, $loudest / $scale), 3);
			}
			return $peaks;
		} finally {
			fclose($file);
		}
	}

	/** 1 for integer PCM, 3 for float; WAVE_FORMAT_EXTENSIBLE, as 24 bits and more channels are written, keeps it in its sub-format */
	private function formatTag(int $fmt): int {
		$tag = $this->u16le($fmt);
		return $tag === 0xFFFE ? $this->u16le($fmt + 24) : $tag;
	}

	/** @return array<string, array{0: int, 1: int}> start and length of the first RIFF chunk of each id */
	private function chunks(): array {
		$size = $this->size();
		$chunks = [];
		for ($pos = 12; $pos + 8 <= $size; $pos += 8 + $length + ($length & 1)) {
			$length = $this->u32le($pos + 4);
			$chunks[$this->at($pos, 4)] ??= [$pos + 8, min($length, $size - $pos - 8)];
		}
		return $chunks;
	}

	/**
	 * The first packet of an Ogg stream names its codec; Theora and the like
	 * are video, which this does not read.
	 *
	 * @return array<string, mixed>|null
	 */
	private function ogg(): ?array {
		$packet = $this->at(27 + ord($this->at(26, 1)), 8);
		return match (true) {
			str_starts_with($packet, "\x01vorbis") => $this->audio('ogg', 'vorbis'),
			$packet === 'OpusHead' => $this->audio('ogg', 'opus'),
			str_starts_with($packet, "\x7FFLAC") => $this->audio('ogg', 'flac'),
			default => null,
		};
	}

	/**
	 * MP3 and ADTS AAC have no container: past an ID3 tag, the first frame's
	 * sync word and layer tell them apart.
	 *
	 * @return array<string, mixed>|null
	 */
	private function mpeg(string $head): ?array {
		$offset = 0;
		if (str_starts_with($head, 'ID3')) {
			// The tag's size is syncsafe: seven bits a byte, plus ten for a footer
			$size = 0;
			for ($i = 6; $i < 10; $i++) {
				$size = ($size << 7) | (ord($head[$i]) & 0x7F);
			}
			$offset = 10 + $size + ((ord($head[5]) & 0x10) === 0 ? 0 : 10);
		}
		[$sync, $bits] = array_map('ord', str_split($this->at($offset, 2)));
		if ($sync !== 0xFF) {
			return null;
		}
		return match (true) {
			($bits & 0xF6) === 0xF0 => $this->audio('aac', 'aac'),
			($bits & 0xE6) === 0xE2 => $this->audio('mp3', 'mp3'),
			default => null,
		};
	}

	/** @return array<string, mixed> audio of a known codec, and nothing else known */
	private function audio(string $format, string $codec): array {
		return [
			'format' => ['format_name' => $format, 'tags' => []],
			'streams' => [['codec_type' => 'audio', 'codec_name' => $codec]],
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

	private function u32le(int $offset): int {
		return (int)unpack('V', $this->at($offset, 4))[1];
	}

	private function u16le(int $offset): int {
		return (int)unpack('v', $this->at($offset, 2))[1];
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
		return fstat($this->file)['size'] ?? 0;
	}

	private function gcd(int $a, int $b): int {
		return $b === 0 ? $a : $this->gcd($b, $a % $b);
	}
}
