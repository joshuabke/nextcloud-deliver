<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Files on an external storage (files_external, the Local backend) are on a
 * Review Link like any other, as far as Files lets the Member who made it
 * share them (ADR 0010). files_external makes a storage with "Enable
 * sharing" off, so the Project says which Assets its Member's links leave out
 * instead of the link silently showing nothing.
 */
class ExternalStorageTest extends TestCase {
	private NextcloudClient $admin;
	private NextcloudClient $member;
	private string $uid;
	private string $dir;
	private int $storageId;
	private int $projectId;
	/** Whether this test switched files_external on, to switch it off again for the rest of the run */
	private bool $enabledApp = false;

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		// Through the web server: an app enabled by occ stays off for Apache until its cached app config expires
		$enabled = $this->admin->ocsForm('GET', '/ocs/v2.php/cloud/apps?filter=enabled');
		self::assertSame(200, $enabled['status'], json_encode($enabled['data']));
		if (!in_array('files_external', $enabled['data']['apps'], true)) {
			$on = $this->admin->ocsForm('POST', '/ocs/v2.php/cloud/apps/files_external');
			self::assertSame(200, $on['status'], json_encode($on['data']));
			$this->enabledApp = true;
		}
		$this->uid = 'deliver-ext-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$made = $this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $this->uid, 'password' => $password]);
		self::assertSame(200, $made['status'], json_encode($made['data']));
		$this->member = $this->admin->withUser($this->uid, $password);

		// A host directory as the tester has it, readable and writable by the web server, mounted for this Member alone
		$this->dir = sys_get_temp_dir() . '/' . $this->uid;
		mkdir($this->dir);
		file_put_contents("{$this->dir}/track.mp3", 'not really audio');
		file_put_contents("{$this->dir}/track-v2.mp3", 'not really audio either');
		$created = $this->occ('files_external:create /Music local null::null -c datadir=' . escapeshellarg($this->dir));
		self::assertSame(1, preg_match('/id (\d+)/', $created, $m), $created);
		$this->storageId = (int)$m[1];
		$this->occ("files_external:applicable {$this->storageId} --add-user " . escapeshellarg($this->uid));
		// Making the user set up their mounts and cached them for minutes, without this one; listing their root sets all of them up again
		$listed = $this->member->request('PROPFIND', "/remote.php/dav/files/{$this->uid}/", null, ['Depth: 1']);
		self::assertSame(207, $listed['status']);

		$project = $this->member->ocs('POST', '/projects', ['name' => 'Album']);
		self::assertSame(201, $project['status'], json_encode($project['data']));
		$this->projectId = $project['data']['id'];
		$enabled = $this->member->ocs('POST', '/assets', ['fileId' => $this->member->fileId('Music/track.mp3'), 'projectId' => $this->projectId, 'newAsset' => true]);
		self::assertSame(201, $enabled['status'], json_encode($enabled['data']));
	}

	protected function tearDown(): void {
		if (isset($this->projectId)) {
			$this->member->deleteProject($this->projectId);
		}
		if (isset($this->storageId)) {
			$this->occ("files_external:delete -y {$this->storageId}");
		}
		if (isset($this->uid)) {
			$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->uid}");
		}
		if ($this->enabledApp) {
			$this->admin->ocsForm('DELETE', '/ocs/v2.php/cloud/apps/files_external');
		}
		if (isset($this->dir)) {
			array_map('unlink', glob("{$this->dir}/*") ?: []);
			@rmdir($this->dir);
		}
	}

	private function occ(string $args): string {
		exec("php /var/www/html/occ $args 2>&1", $output, $code);
		self::assertSame(0, $code, implode("\n", $output));
		return implode("\n", $output);
	}

	/** @return array{PublicClient, list<array<string, mixed>>} a Reviewer on a new Review Link of the Member's, and the Assets it shows them */
	private function onNewLink(): array {
		$link = $this->member->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $link['status'], json_encode($link['data']));
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['data']['token']);
		$shown = $reviewer->call('GET', '/api/assets');
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return [$reviewer, $shown['data']];
	}

	/** @return list<bool> each Asset's offLinks on the Project page */
	private function offLinks(): array {
		$project = $this->member->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(200, $project['status'], json_encode($project['data']));
		return array_column($project['data']['assets'], 'offLinks');
	}

	public function testAStorageWithoutSharingIsOffTheLinksAndTheProjectSaysSo(): void {
		self::assertSame([], $this->onNewLink()[1], 'Files does not let the Member share it, as Nextcloud would not reshare it');
		self::assertSame([true], $this->offLinks(), 'the Project page still shows it, and says the links leave it out');
	}

	public function testAStorageWithSharingIsOnTheLinkLikeAnyOtherFile(): void {
		$this->occ("files_external:option {$this->storageId} enable_sharing true");

		[$reviewer, $shown] = $this->onNewLink();
		self::assertSame(['track'], array_column($shown, 'name'));
		$played = $reviewer->raw(substr($shown[0]['playUrl'], strpos($shown[0]['playUrl'], '/media/')));
		self::assertSame([200, 'not really audio'], [$played['status'], $played['body']], 'and plays from the storage');
		self::assertSame([false], $this->offLinks());
	}

	public function testAnAssetWithAnOlderVersionToShareIsOnTheLinkAndNotMarked(): void {
		// V1 in the Member's home, which they may share; V2 on the storage, which they may not
		$this->member->put('cut.mp3', 'not really audio at home');
		$asset = $this->member->ocs('POST', '/assets', ['fileId' => $this->member->fileId('cut.mp3'), 'projectId' => $this->projectId, 'newAsset' => true]);
		self::assertSame(201, $asset['status'], json_encode($asset['data']));
		$assetId = $asset['data']['assetId'];
		$stacked = $this->member->ocs('POST', '/assets', ['fileId' => $this->member->fileId('Music/track-v2.mp3'), 'projectId' => $this->projectId, 'assetId' => $assetId]);
		self::assertSame(201, $stacked['status'], json_encode($stacked['data']));

		$shown = array_column($this->onNewLink()[1], 'count', 'assetId');
		self::assertSame([$assetId => 1], $shown, 'the link shows the Asset with the Version it may share');
		$project = $this->member->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame([$assetId => false], array_column(array_filter($project['data']['assets'], static fn (array $each) => $each['id'] === $assetId), 'offLinks', 'id'), 'so the Project does not mark it');
		self::assertSame([true], array_values(array_column(array_filter($project['data']['assets'], static fn (array $each) => $each['id'] !== $assetId), 'offLinks')), 'the Asset of the storage alone stays marked');
	}
}
