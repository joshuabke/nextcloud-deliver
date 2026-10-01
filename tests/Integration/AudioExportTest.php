<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Audio-only Versions and the marker files for audio workstations, on a real
 * Broadcast WAV that sits at 01:00:00:00 in its session.
 */
class AudioExportTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

	protected function setUp(): void {
		exec('ffmpeg -version 2>&1', $output, $code);
		if ($code !== 0) {
			self::markTestSkipped('no ffmpeg in this container');
		}
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->fixture = sys_get_temp_dir() . '/deliver-bwf-' . bin2hex(random_bytes(4)) . '.wav';
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
		@unlink($this->fixture);
	}

	private function shell(string $command): string {
		$output = [];
		exec($command . ' 2>&1', $output);
		return implode("\n", $output);
	}

	public function testABroadcastWavExportsItsCommentsForAudioWorkstations(): void {
		// 172800000 samples at 48 kHz: one hour after midnight
		$this->shell(sprintf('ffmpeg -v error -y -f lavfi -i sine=duration=4 -ar 48000 -write_bext 1 -metadata time_reference=172800000 %s', escapeshellarg($this->fixture)));
		$this->nc->put("{$this->root}/atmo.wav", (string)file_get_contents($this->fixture));
		$versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$this->shell('php /var/www/html/occ deliver:worker --once');

		$version = $this->nc->ocs('GET', "/versions/$versionId")['data']['versions'][0];
		self::assertTrue($version['audioOnly']);
		self::assertSame(['num' => 1000, 'den' => 1], $version['fps'], 'audio counts in milliseconds (ADR 0007)');
		self::assertSame(3600000, $version['startFrame'], 'the BWF time reference is the start timecode');

		$range = $this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => 2000, 'outFrame' => 2999, 'body' => 'too loud']);
		self::assertSame(201, $range['status']);
		$this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => 3000, 'body' => 'click']);
		$export = "/apps/deliver/versions/$versionId/export";

		$wav = $this->nc->request('GET', "$export/wav");
		self::assertSame(200, $wav['status']);
		self::assertSame(strlen($wav['body']) - 8, unpack('V', substr($wav['body'], 4, 4))[1], 'the RIFF size covers the added markers');
		self::assertStringContainsString('cue ', $wav['body']);
		self::assertStringContainsString("admin: too loud\0", $wav['body'], 'the label of the first cue point');
		$copy = sys_get_temp_dir() . '/deliver-export-' . bin2hex(random_bytes(4)) . '.wav';
		file_put_contents($copy, $wav['body']);
		$probed = $this->shell('ffprobe -v error -show_entries format=duration:format_tags=time_reference -of default=nw=1 ' . escapeshellarg($copy));
		@unlink($copy);
		self::assertStringContainsString('time_reference=172800000', $probed, 'the copy keeps its place in the session');
		self::assertStringContainsString('duration=4.0', $probed, 'and plays as before');

		$reaper = $this->nc->request('GET', "$export/reaper");
		self::assertStringContainsString('R1,"admin: too loud",1:00:02.000,1:00:03.000,0:00:01.000', $reaper['body']);
		self::assertStringContainsString('M1,"admin: click",0:00:03.000', $this->nc->request('GET', "$export/reaper?zeroBased=1")['body']);

		$csv = $this->nc->request('GET', "$export/csv")['body'];
		self::assertStringContainsString('2000,2999,01:00:02:00,01:00:02:24,admin', $csv, 'milliseconds, and timecode at the Project frame rate');

		$midi = $this->nc->request('GET', "$export/midi?zeroBased=1");
		self::assertSame(200, $midi['status']);
		self::assertStringStartsWith('MThd', $midi['body']);
		self::assertSame(3, substr_count($midi['body'], "\xFF\x06"), 'two markers for the Range, one for the Frame');

		// Ableton: a Live Set goes in and comes back with locators
		$set = sys_get_temp_dir() . '/deliver-set-' . bin2hex(random_bytes(4)) . '.als';
		file_put_contents($set, gzencode('<?xml version="1.0"?><Ableton><LiveSet><Tempo><Manual Value="120" /></Tempo><Locators><Locators /></Locators></LiveSet></Ableton>'));
		$ch = curl_init((getenv('DELIVER_TEST_URL') ?: 'http://localhost') . "$export/ableton?zeroBased=1");
		curl_setopt_array($ch, [
			CURLOPT_POST => true,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_USERPWD => (getenv('DELIVER_TEST_USER') ?: 'admin') . ':' . (getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123'),
			CURLOPT_HTTPHEADER => ['OCS-APIREQUEST: true'],
			CURLOPT_POSTFIELDS => ['set' => new \CURLFile($set)],
		]);
		$body = (string)curl_exec($ch);
		$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		@unlink($set);
		self::assertSame(200, $status, $body);
		$locators = simplexml_load_string((string)gzdecode($body))->LiveSet->Locators->Locators->Locator;
		self::assertSame(['4', '6'], [(string)$locators[0]->Time['Value'], (string)$locators[1]->Time['Value']], '2 s and 3 s at 120 BPM');
	}
}
