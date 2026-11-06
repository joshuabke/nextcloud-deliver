<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * A Proxy made by hand and handed in through Deliver (ADR 0020), with and
 * without ffmpeg: checked like the browser's, it replaces and keeps out the
 * one ffmpeg makes until it is removed, regenerated or the file is written
 * again. ffmpeg makes the fixtures.
 */
class HandProxyTest extends TestCase {
	/** Two seconds of ProRes at 25 fps with PCM, as a master comes out of the edit */
	private const PRORES = '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v prores_ks -profile:v 0 -c:a pcm_s16le -f mov';
	/** A Proxy of it as an editor renders it: H.264/AAC at the same rate with as many Frames */
	private const PROXY = '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest -metadata title=byhand';

	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private string $fixture;

	protected function setUp(): void {
		exec('ffmpeg -version 2>&1', $output, $code);
		if ($code !== 0) {
			self::markTestSkipped('no ffmpeg to make the fixtures');
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
		$this->fixture = sys_get_temp_dir() . '/deliver-hand-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '', 'ffprobePath' => '', 'extraArgs' => '']);
		array_map('unlink', glob($this->fixture . '*') ?: []);
		$this->nc->deleteProject($this->projectId);
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
	}

	private function ffmpeg(string $args, string $to): void {
		exec('ffmpeg -v error -y ' . $args . ' ' . escapeshellarg($to) . ' 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
	}

	private function drainQueue(): void {
		exec('php /var/www/html/occ deliver:worker --once 2>&1', $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
	}

	/** @return int the Version of the master, uploaded */
	private function master(string $args = self::PRORES): int {
		$this->ffmpeg($args, $this->fixture);
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		return $this->card()['id'];
	}

	/** @return array<string, mixed> the newest Version of the Project's only Asset, as its card has it */
	private function card(): array {
		return $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0];
	}

	/** @return array<string, mixed> the Version as the Review view sees it */
	private function version(int $id): array {
		return $this->nc->ocs('GET', "/versions/$id")['data']['versions'][0];
	}

	/** @return array{status: int, data: mixed} the answer to a Proxy rendered so, uploaded next to the master as Deliver's page does */
	private function handIn(int $id, string $args = self::PROXY): array {
		$this->ffmpeg($args . ' -f mp4', $this->fixture . '.mp4');
		$path = "{$this->root}/.deliver-proxy-" . bin2hex(random_bytes(4));
		$this->nc->put($path, (string)file_get_contents($this->fixture . '.mp4'));
		return $this->nc->ocs('POST', "/versions/$id/proxy", ['fileId' => $this->nc->fileId($path)]);
	}

	/** Whether the Version plays the Proxy handed in last, not one ffmpeg made */
	private function playsHandedIn(int $id): bool {
		$url = $this->version($id)['derived']['proxy']['url'];
		return $url !== null && $this->nc->request('GET', $url)['body'] === file_get_contents($this->fixture . '.mp4');
	}

	public function testAProxyHandedInReplacesFfmpegsAndKeepsItOutUntilItIsRemoved(): void {
		// ffmpeg fails on the Proxy, as with a wrong setting
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['extraArgs' => '-no-such-option'])['status']);
		$id = $this->master();
		$this->drainQueue();
		self::assertSame('failed', $this->version($id)['derived']['proxy']['state']);
		self::assertTrue($this->card()['takesProxy']);
		self::assertFalse($this->card()['proxyHandedIn']);

		$refused = $this->handIn($id, '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p');
		self::assertSame(400, $refused['status']);
		self::assertStringContainsString('no sound', $refused['data']['message'], 'the uploader is told why');
		self::assertSame('failed', $this->version($id)['derived']['proxy']['state'], 'a Proxy refused changes nothing');

		$taken = $this->handIn($id);
		self::assertSame(200, $taken['status'], json_encode($taken['data']));
		self::assertTrue($this->card()['proxyHandedIn']);
		self::assertSame('ready', $this->version($id)['derived']['proxy']['state']);
		self::assertTrue($this->playsHandedIn($id));

		// The admin fixes ffmpeg and retries what failed: the Proxy handed in stays
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['extraArgs' => ''])['status']);
		self::assertSame(200, $this->nc->ocs('POST', '/admin/jobs/retry')['status']);
		$this->drainQueue();
		self::assertTrue($this->playsHandedIn($id), 'no Proxy of ffmpeg comes after it');

		$removed = $this->nc->ocs('DELETE', "/versions/$id/proxy");
		self::assertSame(200, $removed['status'], json_encode($removed['data']));
		self::assertFalse($this->card()['proxyHandedIn']);
		self::assertSame('queued', $this->version($id)['derived']['proxy']['state'], 'ffmpeg makes the next at once');
		$this->drainQueue();
		self::assertSame('ready', $this->version($id)['derived']['proxy']['state']);
		self::assertFalse($this->playsHandedIn($id));
		self::assertSame(409, $this->nc->ocs('DELETE', "/versions/$id/proxy")['status'], 'ffmpeg\'s would come right back');

		self::assertSame(200, $this->handIn($id)['status']);
		self::assertTrue($this->playsHandedIn($id), 'it replaces the Proxy ffmpeg made');
		self::assertSame(200, $this->nc->ocs('POST', "/versions/$id/regenerate")['status']);
		self::assertFalse($this->card()['proxyHandedIn'], 'Regenerate drops it');
		$this->drainQueue();
		self::assertFalse($this->playsHandedIn($id));

		self::assertSame(200, $this->handIn($id)['status']);
		$this->nc->put("{$this->root}/master.mov", (string)file_get_contents($this->fixture));
		self::assertSame([false, 'none'], [$this->card()['proxyHandedIn'], $this->version($id)['derived']['proxy']['state']], 'a file written again drops it too');
	}

	public function testAProxyHandedInWithdrawsTheJobMakingOne(): void {
		// ffmpeg waits at the Proxy until the test lets it go on
		file_put_contents($this->fixture . '.ffmpeg', sprintf(
			"#!/bin/sh\ncase \"\$*\" in *0:v:0*) touch %1\$s.running; while [ ! -e %1\$s.go ]; do sleep 0.2; done;; esac\nexec ffmpeg \"\$@\"\n",
			escapeshellarg($this->fixture),
		));
		chmod($this->fixture . '.ffmpeg', 0755);
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => $this->fixture . '.ffmpeg'])['status']);
		$id = $this->master();
		$worker = (int)shell_exec('php /var/www/html/occ deliver:worker --once > /dev/null 2>&1 & echo $!');
		for ($i = 0; $i < 150 && !file_exists($this->fixture . '.running'); $i++) {
			usleep(200_000);
		}
		self::assertFileExists($this->fixture . '.running', 'ffmpeg makes the Proxy');
		self::assertSame('running', $this->version($id)['derived']['proxy']['state']);

		self::assertSame(200, $this->handIn($id)['status']);
		touch($this->fixture . '.go');
		for ($i = 0; $i < 150 && file_exists("/proc/$worker"); $i++) {
			usleep(200_000);
		}
		self::assertFileDoesNotExist("/proc/$worker", 'the worker is done');
		self::assertSame('ready', $this->version($id)['derived']['proxy']['state']);
		self::assertTrue($this->playsHandedIn($id), 'the job did not land over it');
	}

	public function testAVersionThatPlaysAsItIsTakesNoProxy(): void {
		$id = $this->master('-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -f mp4');
		$this->drainQueue();
		self::assertFalse($this->card()['takesProxy']);
		$refused = $this->handIn($id);
		self::assertSame(409, $refused['status']);
		self::assertSame('This Version plays without a Proxy', $refused['data']['message']);
	}

	public function testABrowserConvertingMeanwhileNeitherReplacesAProxyByHandNorFailsOverOne(): void {
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe'])['status']);
		$id = $this->master();
		$this->drainQueue();
		// One Member's tab converts the master
		self::assertSame(200, $this->nc->ocs('POST', "/versions/$id/proxy/progress", ['percent' => 30])['status']);

		$refused = $this->handIn($id, '-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -c:v libx264 -pix_fmt yuv420p');
		self::assertSame(400, $refused['status']);
		$shown = $this->version($id)['derived'];
		self::assertSame(['running', null], [$shown['proxy']['state'], $shown['error']], 'a Proxy by hand refused leaves the conversion as it was');

		// Another hands one in by hand
		self::assertSame(200, $this->handIn($id)['status']);
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/proxy/progress", ['percent' => 60])['status'], 'the converting tab is told to stop');
		$this->ffmpeg('-f lavfi -i testsrc=size=640x360:rate=25:duration=2 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest -f mp4', $this->fixture . '-converted.mp4');
		$path = "{$this->root}/.deliver-proxy-" . bin2hex(random_bytes(4));
		$this->nc->put($path, (string)file_get_contents($this->fixture . '-converted.mp4'));
		self::assertSame(409, $this->nc->ocs('POST', "/versions/$id/proxy", ['converted' => true, 'fileId' => $this->nc->fileId($path)])['status'], 'and its Proxy does not replace the one by hand');
		self::assertTrue($this->playsHandedIn($id));
	}

	public function testWithoutFfmpegARemovedProxyComesFromTheBrowserAgain(): void {
		self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['ffmpegPath' => '/nonexistent/ffmpeg', 'ffprobePath' => '/nonexistent/ffprobe'])['status']);
		$id = $this->master();
		$this->drainQueue();
		self::assertTrue(in_array('proxy', $this->card()['derivedFromBrowser'], true));

		$refused = $this->handIn($id, '-f lavfi -i testsrc=size=640x360:rate=25:duration=1 -f lavfi -i sine=duration=1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest');
		self::assertSame(400, $refused['status']);
		self::assertStringContainsString('other Frames', $refused['data']['message']);
		self::assertSame('none', $this->version($id)['derived']['proxy']['state'], 'only the browser\'s own attempt shows as failed');

		self::assertSame(200, $this->handIn($id)['status'], 'no browser needs to be making one');
		self::assertSame([true, false], [$this->card()['proxyHandedIn'], in_array('proxy', $this->card()['derivedFromBrowser'], true)]);
		self::assertTrue($this->playsHandedIn($id));

		self::assertSame(200, $this->nc->ocs('DELETE', "/versions/$id/proxy")['status']);
		self::assertSame('none', $this->version($id)['derived']['proxy']['state']);
		self::assertSame([false, true], [$this->card()['proxyHandedIn'], in_array('proxy', $this->card()['derivedFromBrowser'], true)], 'the card offers the browser\'s again');
		self::assertSame(404, $this->nc->request('GET', "/index.php/apps/deliver/versions/$id/media/proxy")['status'], 'and the file is gone');
	}
}
