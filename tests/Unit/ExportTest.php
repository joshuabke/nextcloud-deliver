<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\ExportService;
use PHPUnit\Framework\TestCase;

/** The export writers on their own, with Comments as the API serializes them */
class ExportTest extends TestCase {
	private const CLIP = [
		'title' => 'cut v3',
		'file' => 'cut_v3.mov',
		'num' => 25,
		'den' => 1,
		'dropFrame' => false,
		'start' => 90000,
		'duration' => 250,
		'width' => 1920,
		'height' => 1080,
	];

	/** @return list<array<string, mixed>> */
	private static function markers(bool $unresolvedOnly = false): array {
		$comment = static fn (int $id, int $in, ?int $out, string $body, ?int $parent = null, bool $resolved = false) => [
			'id' => $id, 'parentId' => $parent, 'inFrame' => $in, 'outFrame' => $out,
			'author' => ['name' => $parent === null ? 'Mara' : 'Jo'], 'body' => $body, 'resolved' => $resolved,
		];
		return ExportService::markers([
			$comment(1, 50, 74, "longer\nplease"),
			$comment(2, 50, 74, 'agreed', 1),
			$comment(3, 10, null, 'logo | too small', null, true),
		], $unresolvedOnly);
	}

	public function testMarkersFollowTheFramesAndCarryTheirReplies(): void {
		$markers = self::markers();
		self::assertSame([10, 50], array_column($markers, 'in'));
		self::assertSame('Mara: longer please / Jo: agreed', ExportService::note($markers[1]));
		self::assertSame([50], array_column(self::markers(true), 'in'), 'unresolved only');
	}

	public function testEdlCarriesResolveMarkers(): void {
		$edl = ExportService::edl(self::CLIP, self::markers());
		self::assertStringStartsWith("TITLE: cut v3\r\nFCM: NON-DROP FRAME\r\n", $edl);
		self::assertStringContainsString("001  001      V     C        01:00:00:10 01:00:00:11 01:00:00:10 01:00:00:11\r\n |C:ResolveColorGreen |M:Mara: logo / too small |D:1", $edl);
		// 50 to 74 inclusive is 25 Frames, one second
		self::assertStringContainsString("002  001      V     C        01:00:02:00 01:00:03:00 01:00:02:00 01:00:03:00\r\n |C:ResolveColorBlue |M:Mara: longer please / Jo: agreed |D:25", $edl);
	}

	public function testFcpXmlPutsTheMarkersOnOneClip(): void {
		$xml = simplexml_load_string(ExportService::fcpXml(self::CLIP, self::markers()));
		self::assertNotFalse($xml);
		self::assertSame('01:00:00:00', (string)$xml->sequence->timecode->string);
		self::assertSame('25', (string)$xml->sequence->rate->timebase);
		$markers = $xml->sequence->media->video->track->clipitem->marker;
		self::assertCount(2, $markers);
		self::assertSame(['10', '-1'], [(string)$markers[0]->in, (string)$markers[0]->out]);
		self::assertSame(['50', '75'], [(string)$markers[1]->in, (string)$markers[1]->out]);
	}

	public function testFcpxMarksTheClipInRationalSeconds(): void {
		$xml = simplexml_load_string(ExportService::fcpx(self::CLIP, self::markers()));
		self::assertNotFalse($xml);
		self::assertSame('1/25s', (string)$xml->resources->format['frameDuration']);
		$sequence = $xml->library->event->project->sequence;
		self::assertSame(['3600s', 'NDF'], [(string)$sequence['tcStart'], (string)$sequence['tcFormat']]);
		$markers = $sequence->spine->{'asset-clip'}->marker;
		self::assertCount(2, $markers);
		// Frame 10 after 01:00:00:00 at 25 fps; a single Frame lasts one
		self::assertSame(['18002/5s', '1/25s', '1'], [(string)$markers[0]['start'], (string)$markers[0]['duration'], (string)$markers[0]['completed']]);
		self::assertSame(['3602s', '1s', 'Mara: longer please / Jo: agreed'], [(string)$markers[1]['start'], (string)$markers[1]['duration'], (string)$markers[1]['value']]);
	}

	public function testFcpxCountsNtscInThousandths(): void {
		$xml = simplexml_load_string(ExportService::fcpx(['num' => 24000, 'den' => 1001, 'start' => 0, 'width' => null, 'height' => null] + self::CLIP, self::markers()));
		self::assertSame('1001/24000s', (string)$xml->resources->format['frameDuration']);
		self::assertSame('1001/2400s', (string)$xml->library->event->project->sequence->spine->{'asset-clip'}->marker[0]['start']);
	}

	public function testCsvHasOneRowPerComment(): void {
		$handle = fopen('php://memory', 'r+');
		fwrite($handle, ExportService::csv(self::CLIP, self::markers()));
		rewind($handle);
		$rows = [];
		while (($row = fgetcsv($handle, null, ',', '"', '')) !== false) {
			$rows[] = $row;
		}
		fclose($handle);
		self::assertSame(['frame_in', 'frame_out', 'timecode_in', 'timecode_out', 'author', 'comment', 'replies', 'resolved'], $rows[0]);
		self::assertSame(['10', '', '01:00:00:10', '', 'Mara', 'logo | too small', '', 'yes'], $rows[1]);
		self::assertSame(['50', '74', '01:00:02:00', '01:00:02:24', 'Mara', "longer\nplease", 'Jo: agreed', 'no'], $rows[2]);
	}
}
