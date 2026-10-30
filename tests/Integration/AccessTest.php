<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Project Members and their Access levels (ADR 0016) over the HTTP API: what
 * Files gives is the default, a Member with Manage sets more or less, the
 * owner stays, groups add up, and None keeps a Project out of sight.
 */
class AccessTest extends TestCase {
	private NextcloudClient $admin;
	private string $root;
	private int $projectId;
	private int $versionId;
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
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->admin->mkdir($this->root);
		$this->admin->put("{$this->root}/cut.mp4", 'not really a video');
		$created = $this->admin->ocs('POST', '/projects', ['folderId' => $this->admin->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->versionId = $this->admin->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
	}

	protected function tearDown(): void {
		$this->admin->deleteProject($this->projectId);
		foreach ($this->users as $user) {
			$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		foreach ($this->groups as $group) {
			$this->admin->ocsForm('DELETE', '/ocs/v2.php/cloud/groups/' . rawurlencode($group));
		}
		$this->admin->delete($this->root);
	}

	/** @return array{string, NextcloudClient} a new account in English, with the Project folder shared to it when permissions are given */
	private function member(?int $permissions = null): array {
		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		$this->admin->ocsForm('PUT', "/ocs/v2.php/cloud/users/$user", ['key' => 'language', 'value' => 'en']);
		$this->users[] = $user;
		if ($permissions !== null) {
			$this->share(0, $user, $permissions);
		}
		return [$user, $this->admin->withUser($user, $password)];
	}

	private function share(int $type, string $with, int $permissions): void {
		$shared = $this->admin->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}", 'shareType' => $type, 'shareWith' => $with, 'permissions' => $permissions,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
	}

	private function unshare(string $user): void {
		$shares = $this->admin->ocsForm('GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares?path=' . rawurlencode("/{$this->root}"))['data'];
		foreach ($shares as $share) {
			if ($share['share_with'] === $user) {
				self::assertSame(200, $this->admin->ocsForm('DELETE', '/ocs/v2.php/apps/files_sharing/api/v1/shares/' . $share['id'])['status']);
			}
		}
	}

	/** Runs PHP inside this Nextcloud, for what no API does: the periodic scan */
	private function inNextcloud(string $code): void {
		exec('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; \\OCP\\Server::get(\\OCP\\App\\IAppManager::class)->loadApp("deliver"); ' . $code) . ' 2>&1', $output, $status);
		self::assertSame(0, $status, implode("\n", $output));
	}

	private function group(string ...$members): string {
		$group = 'deliver-group-' . bin2hex(random_bytes(4));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/groups', ['groupid' => $group]);
		$this->groups[] = $group;
		foreach ($members as $user) {
			$this->admin->ocsForm('POST', "/ocs/v2.php/cloud/users/$user/groups", ['groupid' => $group]);
		}
		return $group;
	}

	/** @return array<string, mixed> */
	private function setLevel(string $type, string $principal, string $level, bool $share = false, bool $approve = false, ?NextcloudClient $as = null): array {
		return ($as ?? $this->admin)->ocs('PUT', "/projects/{$this->projectId}/members", [
			'type' => $type, 'principal' => $principal, 'level' => $level, 'share' => $share, 'approve' => $approve,
		]);
	}

	/** @return array<string, array<string, mixed>> the Project's Members as the owner lists them, by id */
	private function listed(): array {
		$listed = $this->admin->ocs('GET', "/projects/{$this->projectId}/members");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		$byId = [];
		foreach ($listed['data'] as $row) {
			$byId[$row['id']] = $row;
		}
		return $byId;
	}

	private function comment(NextcloudClient $as, string $body = 'a note'): int {
		return $as->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => $body])['status'];
	}

	private function approve(NextcloudClient $as): int {
		return $as->ocs('PUT', "/versions/{$this->versionId}/approval", ['status' => 'approved'])['status'];
	}

	/** @return list<string> the subjects of Deliver's notifications for this person */
	private function notified(NextcloudClient $as): array {
		$listed = $as->ocsForm('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications')['data'];
		return array_values(array_map(static fn ($n) => $n['subject'], array_filter($listed, static fn ($n) => $n['app'] === 'deliver')));
	}

	public function testReadGivesCommentAndApproveIsASwitch(): void {
		[$user, $member] = $this->member(1);

		self::assertSame(201, $this->comment($member));
		self::assertSame(403, $this->approve($member), 'reading no longer decides on Approvals');
		$comment = $this->admin->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments'][0];
		self::assertSame(403, $member->ocs('PUT', "/comments/{$comment['id']}/resolved", ['resolved' => true])['status']);

		$row = $this->listed()[$user];
		self::assertSame(['comment', false, false, null], [$row['level'], $row['share'], $row['approve'], $row['stored']]);

		$set = $this->setLevel('user', $user, 'comment', approve: true);
		self::assertSame(200, $set['status'], json_encode($set['data']));
		self::assertSame(['comment', true], [$set['data']['level'], $set['data']['approve']]);
		self::assertSame(200, $this->approve($member));

		// Reset takes the Member back to what Files gives
		self::assertSame(200, $this->admin->ocs('DELETE', "/projects/{$this->projectId}/members?type=user&principal=$user")['status']);
		self::assertSame(403, $this->approve($member));
		self::assertNull($this->listed()[$user]['stored']);
	}

	public function testWriteGivesManageWithApprove(): void {
		[$user, $member] = $this->member(15);

		self::assertSame(200, $this->approve($member));
		$comment = $this->admin->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'x'])['data'];
		self::assertSame(200, $member->ocs('PUT', "/comments/{$comment['id']}/resolved", ['resolved' => true])['status']);
		$row = $this->listed()[$user];
		self::assertSame(['manage', false, true], [$row['level'], $row['share'], $row['approve']]);
	}

	public function testViewReadsButDoesNotComment(): void {
		[$user, $member] = $this->member(1);
		$this->admin->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'seen by all']);
		self::assertSame(200, $this->setLevel('user', $user, 'view')['status']);

		self::assertSame(403, $this->comment($member));
		$read = $member->ocs('GET', "/versions/{$this->versionId}/comments");
		self::assertSame(200, $read['status']);
		self::assertFalse($read['data']['canComment']);
		self::assertFalse($read['data']['canApprove']);
		$project = $member->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame('view', $project['data']['access']['level']);
		self::assertFalse($project['data']['manages']);
		// View is notified and can be mentioned
		self::assertContains($user, array_column($this->admin->ocs('GET', "/versions/{$this->versionId}/members")['data'], 'id'));
	}

	public function testViewDoesNotEditOrDeleteOwnComments(): void {
		[$user, $member] = $this->member(1);
		$mine = $member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'first'])['data']['id'];
		$other = $member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 2, 'body' => 'second'])['data']['id'];
		self::assertSame(200, $member->ocs('PUT', "/comments/$mine", ['body' => 'first, better'])['status']);

		// Lowered to View, they read what they wrote but change nothing of it
		self::assertSame(200, $this->setLevel('user', $user, 'view')['status']);
		self::assertSame(403, $member->ocs('PUT', "/comments/$mine", ['body' => 'changed'])['status']);
		self::assertSame(403, $member->ocs('DELETE', "/comments/$mine")['status']);
		$read = $member->ocs('GET', "/versions/{$this->versionId}/comments")['data'];
		self::assertSame(['first, better', 'second'], array_column($read['comments'], 'body'));
		self::assertFalse($read['canChangeOwn'], 'the client offers no Edit or Delete');

		// Comment gives them back their own
		self::assertSame(200, $this->setLevel('user', $user, 'comment')['status']);
		self::assertSame(200, $member->ocs('PUT', "/comments/$mine", ['body' => 'changed'])['status']);
		self::assertSame(200, $member->ocs('DELETE', "/comments/$other")['status']);
	}

	public function testNoneOnAReviewLinkReviewsAsAReviewer(): void {
		[$user, $member] = $this->member(1);
		$token = $this->admin->ocs('POST', "/projects/{$this->projectId}/links")['data']['token'];
		$context = fn () => json_decode($member->request('GET', "/apps/deliver/s/$token/api/context?versionId={$this->versionId}", null, ['Accept: application/json'])['body'], true);
		self::assertSame('member', $context()['me']['type'], 'with Files access they preview the link');

		self::assertSame(200, $this->setLevel('user', $user, 'none')['status']);
		$none = $context();
		self::assertSame(['unnamed', true], [$none['me']['type'], $none['flags']['canComment']], 'with None they are no Member of it, but review as any logged-in non-Member');

		self::assertSame(200, $this->setLevel('user', $user, 'view')['status']);
		self::assertSame('member', $context()['me']['type'], 'and with access again they preview');
	}

	public function testNoneKeepsTheProjectOutOfSight(): void {
		[$user, $member] = $this->member(1);
		$fileId = $this->admin->fileId("{$this->root}/cut.mp4");
		self::assertSame(200, $this->setLevel('user', $user, 'none')['status']);

		self::assertSame(404, $member->ocs('GET', "/projects/{$this->projectId}")['status']);
		self::assertSame(404, $member->ocs('GET', "/versions/{$this->versionId}")['status']);
		self::assertSame(404, $member->ocs('GET', "/versions/{$this->versionId}/comments")['status']);
		self::assertSame(404, $this->comment($member));
		self::assertNotContains($this->projectId, array_column($member->ocs('GET', '/projects')['data'], 'id'));
		self::assertSame(404, $member->ocs('GET', "/folders/{$this->admin->fileId($this->root)}/project")['status']);

		// The Files sidebar learns that the file is in review, and nothing else
		$sidebar = $member->ocs('GET', "/files/$fileId/asset");
		self::assertSame(200, $sidebar['status']);
		self::assertSame(['restricted' => true], $sidebar['data']);

		// No notifications and no Mentions
		$member->ocsForm('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');
		$commented = $this->admin->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => "hello @$user"]);
		self::assertSame([], $commented['data']['mentions']);
		self::assertSame([], $this->notified($member));
		self::assertNotContains($user, array_column($this->admin->ocs('GET', "/versions/{$this->versionId}/members")['data'], 'id'));

		// Back to Comment, and the Project is theirs to see again
		self::assertSame(200, $this->setLevel('user', $user, 'comment')['status']);
		self::assertSame(200, $member->ocs('GET', "/projects/{$this->projectId}")['status']);
	}

	public function testManageWithoutWriteAccessRunsTheReviewButTouchesNoFile(): void {
		[$user, $member] = $this->member(1);
		$this->admin->put("{$this->root}/other.mp4", 'not really a video');
		$assets = $this->admin->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		self::assertCount(2, $assets);
		$comment = $this->admin->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'x'])['data'];
		self::assertSame(403, $member->ocs('PUT', "/comments/{$comment['id']}/resolved", ['resolved' => true])['status']);

		self::assertSame(200, $this->setLevel('user', $user, 'manage')['status']);

		self::assertSame(200, $member->ocs('PUT', "/comments/{$comment['id']}/resolved", ['resolved' => true])['status']);
		$other = array_values(array_filter($assets, fn ($asset) => $asset['versions'][0]['id'] !== $this->versionId))[0];
		$stacked = $member->ocs('POST', "/versions/{$other['versions'][0]['id']}/stack", ['assetId' => $assets[0]['id'] === $other['id'] ? $assets[1]['id'] : $assets[0]['id']]);
		self::assertSame(200, $stacked['status'], json_encode($stacked['data']));
		self::assertSame(200, $member->ocs('PUT', "/projects/{$this->projectId}", ['allowOlder' => true])['status']);

		// Files still has the say over the file itself, also where Deliver renames it inside its lock
		$fileId = $this->admin->fileId("{$this->root}/cut.mp4");
		self::assertSame(403, $member->ocs('POST', "/files/$fileId/rename", ['name' => 'renamed.mp4'])['status'], 'the file is read-only for them');
	}

	public function testRenamingAndReplacingNeedFilesWriteAndManageInTheProject(): void {
		$fileId = $this->admin->fileId("{$this->root}/cut.mp4");
		$this->admin->put("{$this->root}/.deliver-replace-1", 'the new cut');
		$uploadId = $this->admin->fileId("{$this->root}/.deliver-replace-1");
		$rename = fn (NextcloudClient $as, ?int $id = null, string $name = 'renamed.mp4') => $as->ocs('POST', '/files/' . ($id ?? $fileId) . '/rename', ['name' => $name])['status'];
		$replace = fn (NextcloudClient $as) => $as->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => $uploadId])['status'];

		// Files' write access alone is not enough: the Access level decides what is done with the review
		[$user, $member] = $this->member(15);
		foreach (['view', 'comment'] as $level) {
			self::assertSame(200, $this->setLevel('user', $user, $level)['status']);
			self::assertSame([403, 403], [$rename($member), $replace($member)], "$level may not run the review");
		}
		self::assertSame(200, $this->setLevel('user', $user, 'none')['status']);
		self::assertSame([404, 404], [$rename($member), $replace($member)], 'None does not see the Project');
		self::assertSame('not really a video', $this->admin->get("{$this->root}/cut.mp4"));

		// Files has the say over the file itself, whatever the Access level
		[$reader, $readOnly] = $this->member(1);
		self::assertSame(200, $this->setLevel('user', $reader, 'manage')['status']);
		self::assertSame([403, 403], [$rename($readOnly), $replace($readOnly)], 'the file is read-only for them');

		// A file that is no Version takes Files' write access only
		$this->admin->put("{$this->root}/notes.txt", 'x');
		$notes = $this->admin->fileId("{$this->root}/notes.txt");
		self::assertSame(200, $this->setLevel('user', $user, 'view')['status']);
		self::assertSame([403, 200], [$rename($readOnly, $notes, 'a.txt'), $rename($member, $notes, 'b.txt')]);

		// Both together
		self::assertSame(200, $this->setLevel('user', $user, 'manage')['status']);
		self::assertSame(200, $replace($member));
		self::assertSame('the new cut', $this->admin->get("{$this->root}/cut.mp4"));
		self::assertSame(200, $rename($member));
		self::assertSame($fileId, $this->admin->fileId("{$this->root}/renamed.mp4"));
	}

	public function testShareIsOfferedWhereFilesLetsThemReshare(): void {
		[$reshares, $withShare] = $this->member(17);
		[$onlyReads, $reads] = $this->member(1);
		self::assertTrue($this->listed()[$reshares]['canShare']);
		self::assertFalse($this->listed()[$onlyReads]['canShare']);

		// Neither has Share to begin with
		self::assertSame(403, $withShare->ocs('GET', "/projects/{$this->projectId}/links")['status']);

		$refused = $this->setLevel('user', $onlyReads, 'comment', share: true);
		self::assertSame(400, $refused['status'], 'Files does not let them share this');

		$set = $this->setLevel('user', $reshares, 'comment', share: true);
		self::assertSame(200, $set['status'], json_encode($set['data']));
		self::assertTrue($set['data']['share']);
		self::assertSame(200, $withShare->ocs('GET', "/projects/{$this->projectId}/links")['status']);
		self::assertSame(201, $withShare->ocs('POST', "/projects/{$this->projectId}/links")['status']);
		self::assertSame(403, $reads->ocs('GET', "/projects/{$this->projectId}/links")['status']);
		self::assertSame(403, $reads->ocs('POST', "/projects/{$this->projectId}/links")['status']);
	}

	public function testGroupsOnePersonOverridesAndSeveralGroupsAddUp(): void {
		[$both, $inBoth] = $this->member();
		[$onlyViewers, $inViewers] = $this->member();
		[$own, $withOwn] = $this->member();
		$viewers = $this->group($both, $onlyViewers, $own);
		$deciders = $this->group($both);
		$this->share(1, $viewers, 1);
		$this->share(1, $deciders, 1);

		$rows = $this->listed();
		self::assertSame('group', $rows[$viewers]['type']);
		self::assertSame([$viewers], array_column($rows[$onlyViewers]['via'], 'id'));
		self::assertEqualsCanonicalizing([$viewers, $deciders], array_column($rows[$both]['via'], 'id'));

		self::assertSame(200, $this->setLevel('group', $viewers, 'view')['status']);
		self::assertSame(200, $this->setLevel('group', $deciders, 'comment', approve: true)['status']);

		// The highest level and every switch of several groups count
		self::assertSame(201, $this->comment($inBoth));
		self::assertSame(200, $this->approve($inBoth));
		self::assertSame(['comment', true], [$this->listed()[$both]['level'], $this->listed()[$both]['approve']]);
		// One group alone
		self::assertSame(403, $this->comment($inViewers));
		self::assertSame(403, $this->approve($inViewers));

		// A person's own entry wins over their groups, up or down
		self::assertSame(200, $this->setLevel('user', $onlyViewers, 'comment')['status']);
		self::assertSame(201, $this->comment($inViewers));
		self::assertSame(200, $this->setLevel('user', $both, 'view')['status']);
		self::assertSame(403, $this->comment($inBoth));
		self::assertSame(403, $this->approve($inBoth), 'their own entry has no Approve');
		self::assertSame(403, $this->comment($withOwn));
	}

	public function testTheOwnerCannotBeLowered(): void {
		[$user, $member] = $this->member(31);
		self::assertSame(200, $this->setLevel('user', $user, 'manage', approve: true)['status']);
		$owner = $this->listed()['admin'];
		self::assertTrue($owner['owner']);
		self::assertSame(['manage', true, true], [$owner['level'], $owner['share'], $owner['approve']]);

		self::assertSame(403, $this->setLevel('user', 'admin', 'view', as: $member)['status']);
		self::assertSame(403, $member->ocs('DELETE', "/projects/{$this->projectId}/members?type=user&principal=admin")['status']);
		self::assertSame('manage', $this->listed()['admin']['level']);
	}

	public function testManageNeverGrantsAboveItsOwn(): void {
		[$manager, $asManager] = $this->member(31);
		[$other] = $this->member(17);
		self::assertSame(200, $this->setLevel('user', $manager, 'manage')['status']);

		self::assertSame(403, $this->setLevel('user', $other, 'comment', share: true, as: $asManager)['status'], 'a Manage without Share cannot grant Share');
		self::assertSame(403, $this->setLevel('user', $other, 'comment', approve: true, as: $asManager)['status'], 'a Manage without Approve cannot grant Approve');
		self::assertSame(200, $this->setLevel('user', $other, 'view', as: $asManager)['status']);

		// A switch the other already has stays as it is when someone else changes their level
		self::assertSame(200, $this->setLevel('user', $other, 'comment', share: true, approve: true)['status']);
		self::assertSame(200, $this->setLevel('user', $manager, 'manage', approve: true)['status']);
		self::assertSame(200, $this->setLevel('user', $other, 'manage', share: true, approve: true, as: $asManager)['status']);
	}

	public function testNewcomersStartFromTheProjectSetting(): void {
		[$current, $asCurrent] = $this->member(1);
		self::assertSame(200, $this->admin->ocs('PUT', "/projects/{$this->projectId}", ['newcomers' => 'none'])['status']);
		self::assertSame('none', $this->admin->ocs('GET', "/projects/{$this->projectId}")['data']['newcomers']);

		// Who was a Member keeps what Files gives, with no entry made for them
		self::assertSame(201, $this->comment($asCurrent));
		self::assertNull($this->listed()[$current]['stored']);
		self::assertSame('comment', $this->listed()[$current]['level']);

		// Whoever Files gives access later starts from the setting
		[$later, $asLater] = $this->member(1);
		self::assertSame(404, $asLater->ocs('GET', "/projects/{$this->projectId}")['status']);
		self::assertSame(404, $this->comment($asLater));
		self::assertSame('none', $this->listed()[$later]['level']);

		// A change is for the next ones: who came under None stays kept out, who came before stays as they were
		self::assertSame(200, $this->admin->ocs('PUT', "/projects/{$this->projectId}", ['newcomers' => 'view'])['status']);
		self::assertSame(404, $asLater->ocs('GET', "/projects/{$this->projectId}")['status']);
		self::assertSame(201, $this->comment($asCurrent));
		[, $asThird] = $this->member(1);
		self::assertSame('view', $asThird->ocs('GET', "/projects/{$this->projectId}")['data']['access']['level']);
		self::assertSame(403, $this->comment($asThird));

		self::assertSame(400, $this->admin->ocs('PUT', "/projects/{$this->projectId}", ['newcomers' => 'everything'])['status']);
		self::assertSame(200, $this->admin->ocs('PUT', "/projects/{$this->projectId}", ['newcomers' => 'files'])['status']);
		self::assertSame(403, $this->comment($asThird));
		self::assertSame(404, $this->comment($asLater));
		[, $asFourth] = $this->member(1);
		self::assertSame(201, $this->comment($asFourth), 'as in Files again for the next ones');
	}

	private function setNewcomers(string $newcomers): void {
		self::assertSame(200, $this->admin->ocs('PUT', "/projects/{$this->projectId}", ['newcomers' => $newcomers])['status']);
	}

	public function testChangingNewcomersLeavesAFileWriterManagingTheirAsset(): void {
		// A Project with no folder: Files decides per file, and the setting is for newcomers only
		$project = $this->admin->ocs('POST', '/projects', ['name' => 'Loose cuts'])['data']['id'];
		// Outside the folder of the Project that setUp made
		$loose = "{$this->root}-loose.mp4";
		try {
			$this->admin->put($loose, 'not really a video');
			$asset = $this->admin->ocs('POST', '/assets', ['fileId' => $this->admin->fileId($loose), 'projectId' => $project]);
			self::assertSame(201, $asset['status'], json_encode($asset['data']));
			[$writer, $asWriter] = $this->member();
			$shared = $this->admin->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
				'path' => "/$loose", 'shareType' => 0, 'shareWith' => $writer, 'permissions' => 3,
			]);
			self::assertSame(200, $shared['status'], json_encode($shared['data']));
			$version = $asset['data']['versionId'];
			$comment = $this->admin->ocs('POST', "/versions/$version/comments", ['inFrame' => 1, 'body' => 'x'])['data'];
			$resolve = fn () => $asWriter->ocs('PUT', "/comments/{$comment['id']}/resolved", ['resolved' => true])['status'];
			self::assertSame(200, $resolve(), 'a writer of the file manages its review');

			foreach (['view', 'none', 'files'] as $newcomers) {
				self::assertSame(200, $this->admin->ocs('PUT', "/projects/$project", ['newcomers' => $newcomers])['status']);
				self::assertSame(200, $resolve(), "still managing after newcomers $newcomers");
				self::assertSame(200, $asWriter->ocs('GET', "/versions/$version/comments")['status']);
			}
			$members = $this->admin->ocs('GET', "/projects/$project/members")['data'];
			self::assertSame([null], array_column(array_filter($members, static fn ($row) => $row['id'] === $writer), 'stored'));
		} finally {
			$this->admin->deleteProject($project);
			$this->admin->delete($loose);
		}
	}

	public function testNewcomersDoNotPinPeopleWhoComeInThroughAGroup(): void {
		[$user, $member] = $this->member();
		$group = $this->group($user);
		$this->share(1, $group, 1);
		self::assertSame(200, $this->setLevel('group', $group, 'view')['status']);
		self::assertSame(403, $this->comment($member));

		$this->setNewcomers('none');
		self::assertNull($this->listed()[$user]['stored'], 'no entry of their own');
		self::assertSame(403, $this->comment($member), 'still View through the group');

		self::assertSame(200, $this->setLevel('group', $group, 'comment')['status']);
		self::assertSame(201, $this->comment($member), 'later changes of the group reach them');
	}

	public function testAPersonNewInAnOldGroupStartsWhereTheGroupStands(): void {
		[$old] = $this->member();
		$files = $this->group($old);
		$this->share(1, $files, 1);
		// The group is noted under "as in Files"
		$this->setNewcomers('view');

		[$viewers] = $this->member();
		$view = $this->group($viewers);
		$this->share(1, $view, 1);
		// and this one under "View"
		$this->setNewcomers('none');

		[$alone, $asAlone] = $this->member();
		$this->admin->ocsForm('POST', "/ocs/v2.php/cloud/users/$alone/groups", ['groupid' => $files]);
		[$onlyView, $asOnlyView] = $this->member();
		$this->admin->ocsForm('POST', "/ocs/v2.php/cloud/users/$onlyView/groups", ['groupid' => $view]);
		[$both, $asBoth] = $this->member();
		foreach ([$files, $view] as $group) {
			$this->admin->ocsForm('POST', "/ocs/v2.php/cloud/users/$both/groups", ['groupid' => $group]);
		}

		$listed = $this->listed();
		self::assertSame(['comment', 'view', 'comment'], [$listed[$alone]['level'], $listed[$onlyView]['level'], $listed[$both]['level']], 'they have what their group has, the highest of several');
		self::assertSame([null, null, null], [$listed[$alone]['stored'], $listed[$onlyView]['stored'], $listed[$both]['stored']]);
		self::assertSame([201, 403, 201], [$this->comment($asAlone), $this->comment($asOnlyView), $this->comment($asBoth)]);

		// Someone with no group at all is a newcomer of the setting
		[$loner] = $this->member(1);
		self::assertSame('none', $this->listed()[$loner]['level']);
	}

	public function testSwitchingNewcomersChangesNothingForExistingMembers(): void {
		[$reader, $asReader] = $this->member(1);
		[$writer, $asWriter] = $this->member(15);
		foreach (['view', 'none', 'files', 'none', 'view'] as $newcomers) {
			$this->setNewcomers($newcomers);
			self::assertSame(201, $this->comment($asReader), "Comment stays with newcomers $newcomers");
			self::assertSame(200, $this->approve($asWriter), "Manage stays with newcomers $newcomers");
			$listed = $this->listed();
			self::assertSame(['comment', 'manage'], [$listed[$reader]['level'], $listed[$writer]['level']]);
			self::assertSame([null, null], [$listed[$reader]['stored'], $listed[$writer]['stored']]);
		}
	}

	public function testANewcomerAfterTheChangeStartsAtTheSetting(): void {
		[$before] = $this->member(1);
		$this->setNewcomers('view');
		[$after, $asAfter] = $this->member(1);
		self::assertSame(['comment', 'view'], [$this->listed()[$before]['level'], $this->listed()[$after]['level']]);
		self::assertSame(403, $this->comment($asAfter));

		// Another change keeps them where the setting put them when they came; the setting is for the next ones
		$this->setNewcomers('none');
		self::assertSame('view', $this->listed()[$after]['level']);
		[$later] = $this->member(1);
		self::assertSame('none', $this->listed()[$later]['level']);
	}

	public function testATakenBackEntryLeavesWhatTheyCameUnder(): void {
		[$before] = $this->member(1);
		self::assertSame(200, $this->setLevel('user', $before, 'view')['status']);
		$this->setNewcomers('none');
		[$after] = $this->member(1);
		self::assertSame(200, $this->setLevel('user', $after, 'comment')['status']);

		foreach ([$before, $after] as $user) {
			self::assertSame(200, $this->admin->ocs('DELETE', "/projects/{$this->projectId}/members?type=user&principal=$user")['status']);
		}
		// Who was there before the change has what Files gives, who came after it what the setting gave
		self::assertSame(['comment', 'none'], [$this->listed()[$before]['level'], $this->listed()[$after]['level']]);
	}

	public function testWhoLosesAccessComesBackAsANewcomer(): void {
		[$user, $member] = $this->member(1);
		$this->setNewcomers('none');
		self::assertSame('comment', $this->listed()[$user]['level'], 'noted under "as in Files"');

		// The periodic scan forgets them once Files has taken their access back
		$this->unshare($user);
		$this->inNextcloud('\\OCP\\Server::get(\\OCA\\Deliver\\Service\\ProjectMembers::class)->forgetLostAll();');
		$this->share(0, $user, 1);
		self::assertSame('none', $this->listed()[$user]['level'], 'a newcomer of the setting now');

		// So does building the list while they are away
		$this->setNewcomers('view');
		[$other] = $this->member(1);
		self::assertSame('view', $this->listed()[$other]['level']);
		$this->setNewcomers('files');
		self::assertSame('view', $this->listed()[$other]['level'], 'noted under View');
		$this->unshare($other);
		self::assertArrayNotHasKey($other, $this->listed());
		$this->share(0, $other, 1);
		self::assertSame('comment', $this->listed()[$other]['level'], 'a newcomer of "as in Files" now');
	}

	public function testWhoLosesAccessKeepsTheEntryAMemberSetForThem(): void {
		[$user] = $this->member(1);
		self::assertSame(200, $this->setLevel('user', $user, 'view')['status']);
		$this->unshare($user);
		self::assertArrayNotHasKey($user, $this->listed());
		$this->inNextcloud('\\OCP\\Server::get(\\OCA\\Deliver\\Service\\ProjectMembers::class)->forgetLostAll();');
		$this->share(0, $user, 1);
		self::assertSame('view', $this->listed()[$user]['level'], 'a decision about them, not a default');
	}

	public function testOnlyManageSeesAndSetsMembers(): void {
		[$reader, $asReader] = $this->member(1);
		self::assertSame(403, $asReader->ocs('GET', "/projects/{$this->projectId}/members")['status']);
		self::assertSame(403, $this->setLevel('user', $reader, 'manage', as: $asReader)['status']);
		self::assertSame(400, $this->setLevel('user', $reader, 'boss')['status']);
		self::assertSame(400, $this->setLevel('user', 'nobody-' . bin2hex(random_bytes(4)), 'view')['status']);
		self::assertSame(400, $this->setLevel('team', $reader, 'view')['status']);
	}
}
