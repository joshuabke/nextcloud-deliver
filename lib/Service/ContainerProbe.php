<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * What Frames rest on, read without ffprobe (ADR 0003): the frame rate, the
 * start timecode and the duration of a MOV or MP4 from its boxes, and the
 * time reference of a Broadcast WAV, the frame rate, size and duration of a
 * WebM or MKV, the sample rate of an MP3 and the TXXX frames of its ID3 tag.
 * MP3, AAC, FLAC and Ogg are otherwise only known as audio, which counts in
 * milliseconds and needs nothing more; the browser knows their duration.
 * The answer has ffprobe's shape, so Probe treats both alike. Other
 * containers (MXF, AVI) stay unread and take the Project's frame rate. Only headers are read: the media data is skipped by seeking,
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
	/** Matroska's codec ids, as ffprobe names them */
	private const MATROSKA_CODECS = [
		'V_VP8' => 'vp8', 'V_VP9' => 'vp9', 'V_AV1' => 'av1', 'V_MPEG4/ISO/AVC' => 'h264', 'V_MPEGH/ISO/HEVC' => 'hevc',
		'A_OPUS' => 'opus', 'A_VORBIS' => 'vorbis', 'A_AAC' => 'aac', 'A_FLAC' => 'flac', 'A_MPEG/L3' => 'mp3',
	];
	/** Frame rates a Matroska frame duration in whole nanoseconds stands for */
	private const RATES = [[24000, 1001], [30000, 1001], [60000, 1001], [24, 1], [25, 1], [30, 1], [48, 1], [50, 1], [60, 1], [100, 1], [120, 1]];

	/** Sample rates of MPEG 2.5, (reserved), 2 and 1 audio by the index in a frame header */
	private const MPEG_RATES = [[11025, 12000, 8000], [], [22050, 24000, 16000], [44100, 48000, 32000]];
	/** A TXXX frame larger than this is not read: a time reference takes a few dozen bytes, even in UTF-16 */
	private const TXXX_MAX = 4096;

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
			if (str_starts_with($head, "\x1A\x45\xDF\xA3")) {
				return $this->matroska();
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
	 * WebM and MKV are EBML: the header names which, the Segment's Info holds
	 * the duration and its Tracks the codecs, sizes and frame durations. Both
	 * come before the Clusters, where reading stops.
	 *
	 * @return array<string, mixed>|null
	 */
	private function matroska(): ?array {
		$header = $this->element(0, $this->size(), 0x1A45DFA3);
		$segment = $this->element($header[1] ?? 0, $this->size(), 0x18538067);
		if ($header === null || $segment === null) {
			return null;
		}
		$docType = $this->element($header[0], $header[1], 0x4282);
		$seconds = 0.0;
		$streams = [];
		foreach ($this->elements($segment[0], $segment[1]) as [$id, $start, $end]) {
			if ($id === 0x1F43B675) {
				// ponytail: Info and Tracks after the first Cluster go unread; muxers put them first
				break;
			}
			if ($id === 0x1549A966) {
				$scale = $this->element($start, $end, 0x2AD7B1);
				$duration = $this->element($start, $end, 0x4489);
				$seconds = $duration === null ? 0.0 : $this->float($duration) * ($scale === null ? 1000000 : $this->uint($scale)) / 1e9;
			} elseif ($id === 0x1654AE6B) {
				foreach ($this->elements($start, $end) as [$entry, $from, $to]) {
					$stream = $entry === 0xAE ? $this->matroskaTrack($from, $to) : null;
					if ($stream !== null) {
						$streams[] = $stream;
					}
				}
			}
		}
		// ffprobe says matroska,webm for both; Matroska alone has codecs only some browsers play
		$webm = $docType !== null && $this->at($docType[0], $docType[1] - $docType[0]) === 'webm';
		return [
			'format' => ['format_name' => $webm ? 'matroska,webm' : 'matroska', 'duration' => (string)$seconds, 'tags' => []],
			'streams' => $streams,
		];
	}

	/** @return array<string, mixed>|null a video or audio stream, ffprobe's shape */
	private function matroskaTrack(int $start, int $end): ?array {
		$type = $this->element($start, $end, 0x83);
		$codec = $this->element($start, $end, 0x86);
		$kind = match ($type === null ? 0 : $this->uint($type)) {
			1 => 'video',
			2 => 'audio',
			default => null,
		};
		if ($kind === null || $codec === null) {
			return null;
		}
		$id = rtrim($this->at($codec[0], $codec[1] - $codec[0]), "\0");
		$stream = ['codec_type' => $kind, 'codec_name' => self::MATROSKA_CODECS[$id] ?? (str_starts_with($id, 'A_AAC') ? 'aac' : strtolower($id))];
		if ($kind === 'audio') {
			return $stream;
		}
		$video = $this->element($start, $end, 0xE0);
		$width = $video === null ? null : $this->element($video[0], $video[1], 0xB0);
		$height = $video === null ? null : $this->element($video[0], $video[1], 0xBA);
		$stream['width'] = $width === null ? 0 : $this->uint($width);
		$stream['height'] = $height === null ? 0 : $this->uint($height);
		$frame = $this->element($start, $end, 0x23E383);
		$nanoseconds = $frame === null ? 0 : $this->uint($frame);
		if ($nanoseconds > 0) {
			$stream['avg_frame_rate'] = $this->rateOf($nanoseconds);
		}
		if ($stream['codec_name'] === 'h264') {
			// CodecPrivate is the avcC record: its second byte is the profile
			$private = $this->element($start, $end, 0x63A2);
			$profile = $private === null ? 0 : ord($this->at($private[0] + 1, 1));
			$stream['pix_fmt'] = in_array($profile, self::H264_420, true) ? 'yuv420p' : 'unknown';
		}
		return $stream;
	}

	/** A frame duration rounded to whole nanoseconds, back to the rate it was written for: 41708333 is 24000/1001 */
	private function rateOf(int $nanoseconds): string {
		foreach (self::RATES as [$num, $den]) {
			if (abs(1e9 * $den / $num - $nanoseconds) < 1000) {
				return "$num/$den";
			}
		}
		$gcd = $this->gcd(1000000000, $nanoseconds);
		return intdiv(1000000000, $gcd) . '/' . intdiv($nanoseconds, $gcd);
	}

	/** @return \Generator<array{0: int, 1: int, 2: int}> id, start and end of each EBML element's content */
	private function elements(int $start, int $end): \Generator {
		$pos = $start;
		while ($pos < $end) {
			[$id, $idLength] = $this->vint($pos, true);
			[$size, $sizeLength] = $this->vint($pos + $idLength, false);
			if ($idLength === 0 || $sizeLength === 0) {
				return;
			}
			$content = $pos + $idLength + $sizeLength;
			// An unknown size, as live recordings write, runs to the end of its parent
			$to = $size < 0 ? $end : min($end, $content + $size);
			yield [$id, $content, $to];
			$pos = $to;
		}
	}

	/** @return array{0: int, 1: int}|null the content of the first child element of an id */
	private function element(int $start, int $end, int $id): ?array {
		foreach ($this->elements($start, $end) as [$found, $from, $to]) {
			if ($found === $id) {
				return [$from, $to];
			}
		}
		return null;
	}

	/**
	 * EBML's variable-length integer: the leading zeros of the first byte say
	 * how many more follow. An id keeps its marker bit, a size drops it, and a
	 * size of all ones is unknown (-1).
	 *
	 * @return array{0: int, 1: int} the value and its length in bytes, 0 when invalid
	 */
	private function vint(int $pos, bool $id): array {
		$first = ord($this->at($pos, 1));
		$length = $first === 0 ? 0 : 9 - strlen(decbin($first));
		if ($length === 0) {
			return [0, 0];
		}
		$value = $id ? $first : $first & (0xFF >> $length);
		$unknown = $value === (0xFF >> $length);
		foreach (str_split($this->at($pos + 1, $length - 1)) as $byte) {
			if ($byte === '') {
				break;
			}
			$value = ($value << 8) | ord($byte);
			$unknown = $unknown && ord($byte) === 0xFF;
		}
		return [!$id && $unknown ? -1 : $value, $length];
	}

	/** @param array{0: int, 1: int} $element */
	private function uint(array $element): int {
		$value = 0;
		foreach (str_split($this->at($element[0], min(8, $element[1] - $element[0]))) as $byte) {
			$value = ($value << 8) | ord($byte);
		}
		return $value;
	}

	/** @param array{0: int, 1: int} $element */
	private function float(array $element): float {
		return $element[1] - $element[0] === 4
			? (float)unpack('G', $this->at($element[0], 4))[1]
			: (float)unpack('E', $this->at($element[0], 8))[1];
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
		$tags = [];
		if (str_starts_with($head, 'ID3')) {
			// The tag's size is syncsafe: seven bits a byte, plus ten for a footer
			$size = $this->syncsafe(6);
			$offset = 10 + $size + ((ord($head[5]) & 0x10) === 0 ? 0 : 10);
			$tags = $this->id3(ord($head[3]), ord($head[5]), 10 + $size);
		}
		[$sync, $bits, $rate] = array_map('ord', str_split($this->at($offset, 3)));
		if ($sync !== 0xFF) {
			return null;
		}
		if (($bits & 0xF6) === 0xF0) {
			return $this->audio('aac', 'aac', $tags);
		}
		if (($bits & 0xE6) !== 0xE2) {
			return null;
		}
		$mp3 = $this->audio('mp3', 'mp3', $tags);
		// The first frame's header: MPEG 1, 2 or 2.5 in bits 4 and 3, the sample rate's index in bits 3 and 2 of the next byte
		$sampleRate = self::MPEG_RATES[($bits >> 3) & 3][($rate >> 2) & 3] ?? 0;
		if ($sampleRate > 0) {
			$mp3['streams'][0]['sample_rate'] = (string)$sampleRate;
		}
		return $mp3;
	}

	/**
	 * The user-defined text frames (TXXX) of an ID3v2.3 or v2.4 tag, by their
	 * description, as ffprobe names them; the delivering tool puts the start
	 * there (ADR 0012). Other frames, cover art among them, are skipped by
	 * seeking.
	 *
	 * @return array<string, string>
	 */
	private function id3(int $major, int $flags, int $end): array {
		if ($major !== 3 && $major !== 4 || ($flags & 0x80) !== 0) {
			// ponytail: an unsynchronised tag is not read and its start stays 0; read it once a delivering tool writes one
			return [];
		}
		$pos = 10;
		if (($flags & 0x40) !== 0) {
			// An extended header: v2.3 counts its size without the four size bytes, v2.4 with them
			$pos += $major === 3 ? 4 + $this->u32(10) : $this->syncsafe(10);
		}
		$tags = [];
		while ($pos + 10 <= $end) {
			$id = $this->at($pos, 4);
			$size = $major === 3 ? $this->u32($pos + 4) : $this->syncsafe($pos + 4);
			if (!preg_match('/^[A-Z0-9]{4}$/', $id)) {
				break;
			}
			// Compressed, encrypted or otherwise transformed frames say so in the second flag byte
			if ($id === 'TXXX' && $size > 1 && $size <= self::TXXX_MAX && ord($this->at($pos + 9, 1)) === 0) {
				$frame = $this->at($pos + 10, $size);
				$encoding = match (ord($frame[0])) {
					0 => 'ISO-8859-1',
					1 => 'UTF-16',
					2 => 'UTF-16BE',
					3 => 'UTF-8',
					default => null,
				};
				$text = $encoding === null ? '' : (string)mb_convert_encoding(substr($frame, 1), 'UTF-8', $encoding);
				// Description and value end in a null; in UTF-16 each starts with a byte order mark
				[$description, $value] = array_map(
					static fn (string $part) => rtrim((string)preg_replace('/^\x{FEFF}/u', '', $part), "\0"),
					explode("\0", $text, 2) + ['', ''],
				);
				if ($description !== '') {
					$tags[$description] ??= $value;
				}
			}
			$pos += 10 + $size;
		}
		return $tags;
	}

	/** Seven bits a byte, as ID3v2 counts sizes */
	private function syncsafe(int $offset): int {
		$size = 0;
		foreach (str_split($this->at($offset, 4)) as $byte) {
			$size = ($size << 7) | (ord($byte) & 0x7F);
		}
		return $size;
	}

	/**
	 * @param array<string, string> $tags
	 * @return array<string, mixed> audio of a known codec, and nothing else known
	 */
	private function audio(string $format, string $codec, array $tags = []): array {
		return [
			'format' => ['format_name' => $format, 'tags' => $tags],
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
		if ($length < 1) {
			return '';
		}
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
