<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * A Folder Project in a group folder (Team folders, the groupfolders app):
 * the folder's groups are Project Members as groups, and the Project has no
 * owner, so the last Member with Manage stays (ADR 0016). `make up` installs
 * the app.
 */
class GroupFolderTest extends TestCase {
	private NextcloudClient $admin;
	private int $folderId;
	private int $projectId;
	private string $team;
	private string $readers;
	private string $alice;
	private string $bob;
	private string $dana;
	private NextcloudClient $asAlice;
	private NextcloudClient $asBob;
	private NextcloudClient $asDana;
	/** @var list<string> */
	private array $users = [];
	/** @var list<string> */
	private array $groups = [];

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$created = $this->admin->ocsForm('POST', '/apps/groupfolders/folders', ['mountpoint' => 'Team-' . bin2hex(random_bytes(4))]);
		if ($created['status'] !== 200) {
			self::markTestSkipped('The groupfolders app is not installed in this instance (make up enables it): ' . $created['status']);
		}
		$this->folderId = (int)$created['data']['id'];
		[$this->alice, $this->asAlice] = $this->user();
		[$this->bob, $this->asBob] = $this->user();
		[$this->dana, $this->asDana] = $this->user();
		$this->team = $this->group($this->alice, $this->bob);
		$this->readers = $this->group($this->dana);
		$this->giveFolder($this->team, 31);
		$this->giveFolder($this->readers, 1);

		$mount = $this->admin->ocsForm('GET', "/apps/groupfolders/folders/{$this->folderId}")['data']['mount_point'];
		$this->asAlice->mkdir("$mount/Cut");
		$this->asAlice->put("$mount/Cut/cut.mp4", 'not really a video');
		$project = $this->asAlice->ocs('POST', '/projects', ['folderId' => $this->asAlice->fileId("$mount/Cut")]);
		self::assertSame(201, $project['status'], json_encode($project['data']));
		$this->projectId = $project['data']['id'];
	}

	protected function tearDown(): void {
		if (!isset($this->folderId)) {
			return;
		}
		if (isset($this->projectId)) {
			$this->asAlice->deleteProject($this->projectId);
		}
		$this->admin->ocsForm('DELETE', "/apps/groupfolders/folders/{$this->folderId}");
		foreach ($this->users as $user) {
			$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		foreach ($this->groups as $group) {
			$this->admin->ocsForm('DELETE', '/ocs/v2.php/cloud/groups/' . rawurlencode($group));
		}
	}

	/** @return array{string, NextcloudClient} */
	private function user(): array {
		$user = 'deliver-gf-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		$this->admin->ocsForm('PUT', "/ocs/v2.php/cloud/users/$user", ['key' => 'language', 'value' => 'en']);
		$this->users[] = $user;
		return [$user, $this->admin->withUser($user, $password)];
	}

	private function group(string ...$members): string {
		$group = 'deliver-gf-group-' . bin2hex(random_bytes(4));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/groups', ['groupid' => $group]);
		$this->groups[] = $group;
		foreach ($members as $user) {
			$this->admin->ocsForm('POST', "/ocs/v2.php/cloud/users/$user/groups", ['groupid' => $group]);
		}
		return $group;
	}

	private function giveFolder(string $group, int $permissions): void {
		$base = "/apps/groupfolders/folders/{$this->folderId}/groups";
		self::assertSame(200, $this->admin->ocsForm('POST', $base, ['group' => $group])['status']);
		self::assertSame(200, $this->admin->ocsForm('POST', "$base/" . rawurlencode($group), ['permissions' => $permissions])['status']);
	}

	/** @return array<string, array<string, mixed>> */
	private function listed(?NextcloudClient $as = null): array {
		$listed = ($as ?? $this->asAlice)->ocs('GET', "/projects/{$this->projectId}/members");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		$byId = [];
		foreach ($listed['data'] as $row) {
			$byId[$row['id']] = $row;
		}
		return $byId;
	}

	private function setLevel(string $type, string $principal, string $level, ?NextcloudClient $as = null): array {
		return ($as ?? $this->asAlice)->ocs('PUT', "/projects/{$this->projectId}/members", [
			'type' => $type, 'principal' => $principal, 'level' => $level, 'share' => false, 'approve' => false,
		]);
	}

	public function testTheFoldersGroupsAreListedAsGroups(): void {
		$listed = $this->listed();

		// The groups of the folder, each once, with what the folder gives them
		self::assertSame(['group', 'manage'], [$listed[$this->team]['type'], $listed[$this->team]['level']]);
		self::assertSame(['group', 'comment'], [$listed[$this->readers]['type'], $listed[$this->readers]['level']]);
		self::assertSame([true, false], [$listed[$this->team]['canShare'], $listed[$this->readers]['canShare']]);
		// Their people come in through them
		self::assertSame([$this->team], array_column($listed[$this->bob]['via'], 'id'));
		self::assertSame([$this->readers], array_column($listed[$this->dana]['via'], 'id'));
		// A group folder has no owner
		self::assertNotContains(true, array_column($listed, 'owner'));
	}

	public function testNobodyOwnsAProjectInAGroupFolder(): void {
		$listed = $this->listed();
		self::assertNotContains(true, array_column($listed, 'owner'));
		self::assertFalse($listed[$this->alice]['share'], 'Share is the owner\'s by default');
		self::assertFalse($listed[$this->bob]['share']);

		// Read access in the folder gives Comment, never Manage or Share
		$project = $this->asDana->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(200, $project['status']);
		self::assertSame(['comment', false], [$project['data']['access']['level'], $project['data']['access']['share']]);
		self::assertSame(403, $this->asDana->ocs('GET', "/projects/{$this->projectId}/members")['status']);
	}

	public function testTheLastMemberWithManageStays(): void {
		// Two people manage through the folder's group
		self::assertSame(200, $this->setLevel('user', $this->bob, 'view')['status']);
		$last = $this->setLevel('user', $this->alice, 'view');
		self::assertSame(409, $last['status'], 'the last Member with Manage cannot be lowered: ' . json_encode($last['data']));
		self::assertSame('manage', $this->listed()[$this->alice]['level']);
		self::assertNull($this->listed()[$this->alice]['stored'], 'and nothing was left behind');

		// Nor can the group they manage through be lowered under them
		$group = $this->setLevel('group', $this->team, 'view');
		self::assertSame(409, $group['status'], json_encode($group['data']));
		self::assertNull($this->listed()[$this->team]['stored']);

		// Another Member with Manage frees them
		self::assertSame(200, $this->setLevel('user', $this->bob, 'manage')['status']);
		self::assertSame(200, $this->setLevel('user', $this->alice, 'view')['status']);
		self::assertSame(409, $this->setLevel('user', $this->bob, 'comment', $this->asBob)['status'], 'bob is the last now');
	}

	public function testALevelForTheGroupReachesItsPeople(): void {
		self::assertSame(200, $this->setLevel('group', $this->readers, 'view')['status']);
		self::assertSame('view', $this->listed()[$this->dana]['level']);
		self::assertSame('view', $this->asDana->ocs('GET', "/projects/{$this->projectId}")['data']['access']['level']);
	}
}
