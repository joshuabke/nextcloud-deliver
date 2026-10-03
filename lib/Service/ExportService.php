<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\Version;
use OCP\Files\File;
use OCP\Files\IRootFolder;

/**
 * Exports the Comments of one Version for an editing application or an
 * audio workstation (spec: Export): CMX3600 EDL with DaVinci Resolve's marker
 * notes, FCP7 XML for Premiere Pro, FCPXML for Final Cut Pro, CSV, and for audio a WAV with embedded
 * markers, a MIDI marker file, REAPER's marker CSV and locators in an Ableton
 * Live Set. Timecodes start at the file's embedded start unless the export
 * is zero-based.
 */
class ExportService {
	/** Format => [MIME type, file name ending] */
	private const FORMATS = [
		'edl' => ['text/plain', '.edl'],
		'fcpxml' => ['application/xml', '.xml'],
		'fcpx' => ['application/xml', '.fcpxml'],
		'csv' => ['text/csv', '.csv'],
		'wav' => ['audio/wav', ' markers.wav'],
		'midi' => ['audio/midi', ' markers.mid'],
		'reaper' => ['text/csv', ' REAPER markers.csv'],
		'ableton' => ['application/octet-stream', ' with locators.als'],
	];

	public function __construct(
		private CommentService $comments,
		private AssetMapper $assets,
		private StackService $stacks,
		private WavExport $wav,
		private IRootFolder $root,
	) {
	}

	/**
	 * @param ?string $liveSet for `ableton`: the uploaded .als to add the locators to
	 * @throws AccessDeniedException exporting needs write access (stories 67 to 69)
	 * @throws InvalidRequestException an unknown format, or an Ableton export without a Live Set
	 * @return array{name: string, mime: string, body?: string, path?: string} the file, as content or as a temporary file the caller deletes
	 */
	public function export(Viewer $viewer, Version $version, Project $project, string $format, bool $unresolvedOnly, bool $zeroBased, ?string $liveSet = null): array {
		if (!$viewer->canWrite) {
			throw new AccessDeniedException('Exporting needs write access to the file');
		}
		if (!isset(self::FORMATS[$format])) {
			throw new InvalidRequestException('Exports come as ' . implode(', ', array_keys(self::FORMATS)));
		}
		if ($format === 'ableton' && $liveSet === null) {
			throw new InvalidRequestException('Upload a Live Set to add the locators to');
		}
		$asset = $this->assets->find($version->getAssetId());
		$title = ($asset === null ? pathinfo($version->getName(), PATHINFO_FILENAME) : $this->stacks->nameOf($asset))
			. ' v' . $version->getNumber();
		$clip = [
			'title' => $title,
			'file' => $version->getName(),
			'num' => $version->getFpsNum() ?? $project->getFpsNum(),
			'den' => $version->getFpsDen() ?? $project->getFpsDen(),
			'dropFrame' => (bool)$version->getDropFrame(),
			// Audio counts in milliseconds; its timecode is read at the Project's frame rate (ADR 0007)
			'timecode' => $version->getHasAudio() && !$version->getHasVideo() ? [$project->getFpsNum(), $project->getFpsDen()] : null,
			'start' => $zeroBased ? 0 : ($version->getStartFrame() ?? 0),
			'duration' => $version->getDurationFrames(),
			'width' => $version->getWidth(),
			'height' => $version->getHeight(),
		];
		$markers = self::markers($this->comments->list($viewer, $version)['comments'], $unresolvedOnly);
		[$mime, $ending] = self::FORMATS[$format];
		$file = ['name' => $title . $ending, 'mime' => $mime];
		if ($format === 'wav') {
			return $file + ['path' => $this->wav->render($this->fileOf($version), $clip, $markers)];
		}
		return $file + ['body' => match ($format) {
			'edl' => self::edl($clip, $markers),
			'fcpxml' => self::fcpXml($clip, $markers),
			'fcpx' => self::fcpx($clip, $markers),
			'csv' => self::csv($clip, $markers),
			'midi' => DawMarkers::midi($clip, $markers),
			'reaper' => DawMarkers::reaper($clip, $markers),
			'ableton' => DawMarkers::ableton($liveSet, $clip, $markers),
		}];
	}

	/** @throws ProjectConflictException the Version's file is gone */
	private function fileOf(Version $version): File {
		$file = $this->root->getFirstNodeById($version->getFileId());
		if (!$file instanceof File) {
			throw new ProjectConflictException('The file of this Version is gone');
		}
		return $file;
	}

	/**
	 * Top-level Comments in Frame order, each with its Replies (story 71).
	 *
	 * @param list<array<string, mixed>> $comments as CommentService serializes them
	 * @return list<array{in: int, out: ?int, author: string, body: string, resolved: bool, replies: list<array{author: string, body: string}>}>
	 */
	public static function markers(array $comments, bool $unresolvedOnly): array {
		$replies = [];
		foreach ($comments as $comment) {
			if ($comment['parentId'] !== null) {
				$replies[$comment['parentId']][] = ['author' => $comment['author']['name'], 'body' => self::readable($comment)];
			}
		}
		$markers = [];
		foreach ($comments as $comment) {
			if ($comment['parentId'] !== null || ($unresolvedOnly && $comment['resolved'])) {
				continue;
			}
			$markers[] = [
				'in' => $comment['inFrame'],
				'out' => $comment['outFrame'],
				'author' => $comment['author']['name'],
				'body' => self::readable($comment),
				'resolved' => (bool)$comment['resolved'],
				'replies' => $replies[$comment['id']] ?? [],
			];
		}
		usort($markers, static fn (array $a, array $b) => $a['in'] <=> $b['in']);
		return $markers;
	}

	/** A Comment's body with its @mentions as display names */
	private static function readable(array $comment): string {
		return Mentions::render((string)$comment['body'], (array)($comment['mentions'] ?? []));
	}

	/** The marker text: author, body and Replies on one line, as marker notes are single lines */
	public static function note(array $marker): string {
		$text = $marker['author'] . ': ' . $marker['body'];
		foreach ($marker['replies'] as $reply) {
			$text .= ' / ' . $reply['author'] . ': ' . $reply['body'];
		}
		return self::oneLine($text);
	}

	/** A Range is inclusive, so its duration counts the out Frame; a single Frame lasts one */
	private static function duration(array $marker): int {
		return $marker['out'] === null ? 1 : $marker['out'] - $marker['in'] + 1;
	}

	/** The clip's length in Frames, long enough for its last marker */
	private static function length(array $clip, array $markers): int {
		$lastMarker = 0;
		foreach ($markers as $marker) {
			$lastMarker = max($lastMarker, $marker['in'] + self::duration($marker));
		}
		return max((int)$clip['duration'], $lastMarker, 1);
	}

	/** The timecode of a Frame, counted from the clip's start */
	private static function tc(array $clip, int $frame): string {
		[$num, $den] = $clip['timecode'] ?? [$clip['num'], $clip['den']];
		$at = intdiv(($clip['start'] + $frame) * $num * $clip['den'], $den * $clip['num']);
		return Timecode::format($at, $num, $den, $clip['dropFrame']);
	}

	/**
	 * CMX3600 with one event per Comment and Resolve's marker line under it,
	 * which Resolve reads through "Import Timeline Markers from EDL" (story 67).
	 *
	 * @param list<array<string, mixed>> $markers
	 */
	public static function edl(array $clip, array $markers): string {
		$lines = [
			'TITLE: ' . self::oneLine($clip['title']),
			'FCM: ' . ($clip['dropFrame'] ? 'DROP FRAME' : 'NON-DROP FRAME'),
			'',
		];
		foreach ($markers as $index => $marker) {
			$in = self::tc($clip, $marker['in']);
			$out = self::tc($clip, $marker['in'] + self::duration($marker));
			$lines[] = sprintf('%03d  001      V     C        %s %s %s %s', $index + 1, $in, $out, $in, $out);
			// Resolve splits marker fields at "|", so the note must not contain one
			$lines[] = sprintf(
				' |C:%s |M:%s |D:%d',
				$marker['resolved'] ? 'ResolveColorGreen' : 'ResolveColorBlue',
				str_replace('|', '/', self::note($marker)),
				self::duration($marker),
			);
			$lines[] = '';
		}
		return implode("\r\n", $lines) . "\r\n";
	}

	/** FCP7 XML: one sequence holding the Version as one clip, the Comments as its markers (story 68) */
	public static function fcpXml(array $clip, array $markers): string {
		$ntsc = $clip['den'] === 1001 ? 'TRUE' : 'FALSE';
		$timebase = Timecode::nominal($clip['num'], $clip['den']);
		$duration = self::length($clip, $markers);

		$xml = new \XMLWriter();
		$xml->openMemory();
		$xml->setIndent(true);
		$xml->setIndentString("\t");
		$xml->startDocument('1.0', 'UTF-8');
		$xml->writeDtd('xmeml');
		$xml->startElement('xmeml');
		$xml->writeAttribute('version', '5');
		$xml->startElement('sequence');
		$xml->writeAttribute('id', 'sequence-1');
		$xml->writeElement('name', $clip['title']);
		$xml->writeElement('duration', (string)$duration);
		self::rate($xml, $timebase, $ntsc);
		$xml->startElement('timecode');
		self::rate($xml, $timebase, $ntsc);
		$xml->writeElement('string', self::tc($clip, 0));
		$xml->writeElement('frame', (string)$clip['start']);
		$xml->writeElement('displayformat', $clip['dropFrame'] ? 'DF' : 'NDF');
		$xml->endElement();
		$xml->startElement('media');
		$xml->startElement('video');
		$xml->startElement('track');
		$xml->startElement('clipitem');
		$xml->writeAttribute('id', 'clipitem-1');
		$xml->writeElement('name', $clip['file']);
		$xml->writeElement('duration', (string)$duration);
		self::rate($xml, $timebase, $ntsc);
		foreach (['start' => 0, 'end' => $duration, 'in' => 0, 'out' => $duration] as $name => $value) {
			$xml->writeElement($name, (string)$value);
		}
		$xml->startElement('file');
		$xml->writeAttribute('id', 'file-1');
		$xml->writeElement('name', $clip['file']);
		$xml->writeElement('pathurl', rawurlencode($clip['file']));
		self::rate($xml, $timebase, $ntsc);
		$xml->writeElement('duration', (string)$duration);
		$xml->endElement();
		foreach ($markers as $marker) {
			$xml->startElement('marker');
			$xml->writeElement('name', $marker['author']);
			$xml->writeElement('comment', self::note($marker));
			$xml->writeElement('in', (string)$marker['in']);
			$xml->writeElement('out', (string)($marker['out'] === null ? -1 : $marker['out'] + 1));
			$xml->endElement();
		}
		$xml->endElement(); // clipitem
		$xml->endElement(); // track
		$xml->endElement(); // video
		$xml->endElement(); // media
		$xml->endElement(); // sequence
		$xml->endElement(); // xmeml
		$xml->endDocument();
		return $xml->outputMemory();
	}

	private static function rate(\XMLWriter $xml, int $timebase, string $ntsc): void {
		$xml->startElement('rate');
		$xml->writeElement('timebase', (string)$timebase);
		$xml->writeElement('ntsc', $ntsc);
		$xml->endElement();
	}

	/**
	 * FCPXML for Final Cut Pro: a project whose one clip is the Version, the
	 * Comments as its markers. The clip comes in offline and relinks to the
	 * original file; a resolved Comment is a completed to-do marker (story 86).
	 */
	public static function fcpx(array $clip, array $markers): string {
		// FCPXML counts time in rational seconds, so every value is Frames × den / num
		$time = static function (int $frames) use ($clip): string {
			$numerator = $frames * $clip['den'];
			$divisor = self::gcd($numerator, $clip['num']);
			$denominator = intdiv($clip['num'], $divisor);
			return intdiv($numerator, $divisor) . ($denominator === 1 ? '' : '/' . $denominator) . 's';
		};
		$duration = $time(self::length($clip, $markers));
		$start = $time($clip['start']);

		$xml = new \XMLWriter();
		$xml->openMemory();
		$xml->setIndent(true);
		$xml->setIndentString("\t");
		$xml->startDocument('1.0', 'UTF-8');
		$xml->writeDtd('fcpxml');
		$xml->startElement('fcpxml');
		$xml->writeAttribute('version', '1.10');
		$xml->startElement('resources');
		$xml->startElement('format');
		$xml->writeAttribute('id', 'r1');
		$xml->writeAttribute('frameDuration', $time(1));
		if ($clip['width'] !== null && $clip['height'] !== null) {
			$xml->writeAttribute('width', (string)$clip['width']);
			$xml->writeAttribute('height', (string)$clip['height']);
		}
		$xml->endElement();
		$xml->startElement('asset');
		$xml->writeAttribute('id', 'r2');
		$xml->writeAttribute('name', $clip['file']);
		$xml->writeAttribute('start', $start);
		$xml->writeAttribute('duration', $duration);
		$xml->writeAttribute('hasVideo', '1');
		$xml->writeAttribute('hasAudio', '1');
		$xml->writeAttribute('format', 'r1');
		$xml->startElement('media-rep');
		$xml->writeAttribute('kind', 'original-media');
		$xml->writeAttribute('src', 'file:///' . rawurlencode($clip['file']));
		$xml->endElement();
		$xml->endElement(); // asset
		$xml->endElement(); // resources
		$xml->startElement('library');
		$xml->startElement('event');
		$xml->writeAttribute('name', 'Deliver');
		$xml->startElement('project');
		$xml->writeAttribute('name', $clip['title']);
		$xml->startElement('sequence');
		$xml->writeAttribute('format', 'r1');
		$xml->writeAttribute('tcStart', $start);
		$xml->writeAttribute('tcFormat', $clip['dropFrame'] ? 'DF' : 'NDF');
		$xml->writeAttribute('duration', $duration);
		$xml->startElement('spine');
		$xml->startElement('asset-clip');
		$xml->writeAttribute('ref', 'r2');
		$xml->writeAttribute('name', $clip['file']);
		$xml->writeAttribute('offset', $start);
		$xml->writeAttribute('start', $start);
		$xml->writeAttribute('duration', $duration);
		$xml->writeAttribute('format', 'r1');
		$xml->writeAttribute('tcFormat', $clip['dropFrame'] ? 'DF' : 'NDF');
		// Markers sit in the clip's own time, which starts at its start timecode
		foreach ($markers as $marker) {
			$xml->startElement('marker');
			$xml->writeAttribute('start', $time($clip['start'] + $marker['in']));
			$xml->writeAttribute('duration', $time(self::duration($marker)));
			$xml->writeAttribute('value', self::note($marker));
			$xml->writeAttribute('completed', $marker['resolved'] ? '1' : '0');
			$xml->endElement();
		}
		$xml->endElement(); // asset-clip
		$xml->endElement(); // spine
		$xml->endElement(); // sequence
		$xml->endElement(); // project
		$xml->endElement(); // event
		$xml->endElement(); // library
		$xml->endElement(); // fcpxml
		$xml->endDocument();
		return $xml->outputMemory();
	}

	private static function gcd(int $a, int $b): int {
		return $b === 0 ? max(1, abs($a)) : self::gcd($b, $a % $b);
	}

	/** One row per Comment, Replies in one column (story 69) */
	public static function csv(array $clip, array $markers): string {
		$handle = fopen('php://temp', 'r+');
		fputcsv($handle, ['frame_in', 'frame_out', 'timecode_in', 'timecode_out', 'author', 'comment', 'replies', 'resolved'], ',', '"', '');
		foreach ($markers as $marker) {
			fputcsv($handle, [
				$marker['in'],
				$marker['out'] ?? '',
				self::tc($clip, $marker['in']),
				$marker['out'] === null ? '' : self::tc($clip, $marker['out']),
				$marker['author'],
				$marker['body'],
				implode("\n", array_map(static fn (array $reply) => $reply['author'] . ': ' . $reply['body'], $marker['replies'])),
				$marker['resolved'] ? 'yes' : 'no',
			], ',', '"', '');
		}
		rewind($handle);
		$csv = (string)stream_get_contents($handle);
		fclose($handle);
		return $csv;
	}

	private static function oneLine(string $text): string {
		return trim((string)preg_replace('/\s+/', ' ', $text));
	}
}
