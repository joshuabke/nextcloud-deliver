<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\DawMarkers;
use OCA\Deliver\Service\InvalidRequestException;
use PHPUnit\Framework\TestCase;

/** The marker files for audio workstations, byte by byte where it matters */
class DawMarkersTest extends TestCase {
	private const CLIP = ['title' => 'atmo v1', 'num' => 25, 'den' => 1, 'start' => 0];

	/** A Range from 2 s to 3 s and a single Frame at 10 s */
	private const MARKERS = [
		['in' => 50, 'out' => 74, 'author' => 'Mara', 'body' => 'too loud', 'resolved' => false, 'replies' => []],
		['in' => 250, 'out' => null, 'author' => 'Jo', 'body' => 'click', 'resolved' => false, 'replies' => []],
	];

	public function testMidiMarkersSitAtTheirSecondsAt120Bpm(): void {
		$midi = DawMarkers::midi(self::CLIP, self::MARKERS);
		self::assertSame('MThd', substr($midi, 0, 4));
		self::assertSame([6, 0, 1, 960], array_values(unpack('Nlength/nformat/ntracks/ndivision', substr($midi, 4, 10))));
		// Delta times: 2 s = 3840 ticks, then 1 s to the Range's end, then 7 s to the next marker
		self::assertStringContainsString("\x9E\x00\xFF\x06\x0EMara: too loud", $midi);
		self::assertStringContainsString("\x8F\x00\xFF\x06\x13End: Mara: too loud", $midi);
		self::assertStringContainsString("\xE9\x00\xFF\x06\x09Jo: click", $midi);
		self::assertStringEndsWith("\x00\xFF\x2F\x00", $midi);
	}

	public function testReaperGetsMarkersAndRegions(): void {
		self::assertSame(
			"#,Name,Start,End,Length\nR1,\"Mara: too loud\",0:00:02.000,0:00:03.000,0:00:01.000\nM1,\"Jo: click\",0:00:10.000,,\n",
			DawMarkers::reaper(self::CLIP, self::MARKERS),
		);
	}

	public function testWavChunksCountSamplesFromTheStartOfTheFile(): void {
		$chunks = DawMarkers::wavChunks(self::CLIP + ['start' => 90000], self::MARKERS, 48000);
		self::assertSame('cue ', substr($chunks, 0, 4));
		['size' => $size, 'count' => $count] = unpack('Vsize/Vcount', substr($chunks, 4, 8));
		self::assertSame([52, 2], [$size, $count]);
		// The first cue point: id 1 at 2 s, whatever the file's place in the session
		self::assertSame([1, 96000], array_values(unpack('Vid/Vposition', substr($chunks, 12, 8))));
		self::assertStringContainsString('labl', $chunks);
		self::assertStringContainsString('ltxt' . pack('V', 20) . pack('VV', 1, 48000) . 'rgn ', $chunks, 'the Range is one second long');
	}

	public function testLocatorsGoIntoALiveSetInBeats(): void {
		$set = gzencode('<?xml version="1.0"?><Ableton><LiveSet><MasterTrack><Tempo><LomId Value="0" /><Manual Value="90" /></Tempo></MasterTrack>'
			. '<Locators><Locators /></Locators></LiveSet></Ableton>');
		$xml = simplexml_load_string(gzdecode(DawMarkers::ableton($set, self::CLIP, self::MARKERS)));
		$locators = $xml->LiveSet->Locators->Locators->Locator;
		self::assertCount(2, $locators);
		// 2 s at 90 BPM are 3 beats
		self::assertSame(['0', '3', 'Mara: too loud'], [(string)$locators[0]['Id'], (string)$locators[0]->Time['Value'], (string)$locators[0]->Name['Value']]);
		self::assertSame('15', (string)$locators[1]->Time['Value']);
	}

	public function testSomethingElseIsNoLiveSet(): void {
		$this->expectException(InvalidRequestException::class);
		DawMarkers::ableton('not gzip', self::CLIP, self::MARKERS);
	}
}
