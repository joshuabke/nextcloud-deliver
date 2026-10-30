<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * The file of a Version with Comments or Approvals is locked against
 * overwriting, renaming and deleting outside Deliver (ADR 0018), seen from
 * where a sync client sees it: WebDAV answers 423, and Files names Deliver as
 * the holder. Where there is no lock, an overwrite marks the Comments and
 * notifies the Members.
 */
class FilesInReviewTest extends TestCase {
	private NextcloudClient $admin;
	/** The owner of the Project, a user of its own in English, whatever language the admin speaks */
	private NextcloudClient $nc;
	private string $owner;
	private NextcloudClient $member;
	private string $user;
	private string $root;
	private int $projectId;
	private int $versionId;
	private int $assetId;

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->owner = 'deliver-owner-' . bin2hex(random_bytes(4));
		$this->nc = $this->englishUser($this->owner);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->readProject();

		$this->user = 'deliver-member-' . bin2hex(random_bytes(4));
		$this->member = $this->englishUser($this->user);
		$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $this->user, 'permissions' => 31,
		]);
	}

	protected function tearDown(): void {
		$this->nc->deleteProject($this->projectId);
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->user}");
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->owner}");
	}

	private function englishUser(string $uid): NextcloudClient {
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		$this->admin->ocsForm('PUT', "/ocs/v2.php/cloud/users/$uid", ['key' => 'language', 'value' => 'en']);
		return $this->admin->withUser($uid, $password);
	}

	private function readProject(): void {
		$asset = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0];
		$this->assetId = $asset['id'];
		$this->versionId = $asset['versions'][0]['id'];
	}

	private function comment(string $body = 'warmer please'): int {
		$created = $this->member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => $body]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data']['id'];
	}

	/** @return array<string, mixed> the Version as the Review view sees it */
	private function version(): array {
		return $this->nc->ocs('GET', "/versions/{$this->versionId}")['data']['versions'][0];
	}

	/** @return list<string> the subjects of Deliver's notifications for this person */
	private function subjects(NextcloudClient $client): array {
		$listed = $client->ocsForm('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications');
		return array_values(array_map(
			static fn (array $n) => $n['subject'],
			array_filter($listed['data'] ?? [], static fn (array $n) => $n['app'] === 'deliver'),
		));
	}

	private function setLock(bool $on): void {
		$updated = $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['lockFiles' => $on]);
		self::assertSame([200, $on], [$updated['status'], $updated['data']['lockFiles'] ?? null], json_encode($updated['data']));
	}

	public function testACommentLocksTheFileAgainstEveryoneAndTheLastOneFreesIt(): void {
		$path = "{$this->root}/cut.mp4";
		self::assertNull($this->nc->lockedBy($path), 'nothing is locked before anyone comments');

		$first = $this->comment();
		$second = $this->comment('and louder');
		self::assertSame('Deliver', $this->nc->lockedBy($path), 'Files shows who holds it');
		self::assertSame(
			[423, 423, 423],
			[$this->nc->davStatus('PUT', $path, 'another cut'), $this->nc->davStatus('MOVE', $path, null, "{$this->root}/renamed.mp4"), $this->nc->davStatus('DELETE', $path)],
			'its owner and their sync client included',
		);
		self::assertSame(423, $this->member->davStatus('PUT', "{$this->root}/cut.mp4", 'another cut'), 'and whoever shares it');
		self::assertSame('not really a video', $this->nc->get($path));

		$this->nc->ocs('DELETE', "/comments/$first");
		self::assertSame('Deliver', $this->nc->lockedBy($path), 'one Comment is left');
		$this->nc->ocs('DELETE', "/comments/$second");
		self::assertNull($this->nc->lockedBy($path));
		self::assertSame(204, $this->nc->davStatus('PUT', $path, 'not really a video'));
	}

	public function testAnApprovalLocksToo(): void {
		$path = "{$this->root}/cut.mp4";
		$decide = fn (?string $status) => $this->member->ocs('PUT', "/versions/{$this->versionId}/approval", ['status' => $status]);
		self::assertSame(200, $decide('approved')['status']);
		self::assertSame('Deliver', $this->nc->lockedBy($path));
		$comment = $this->comment();
		self::assertSame(200, $decide(null)['status']);
		self::assertSame('Deliver', $this->nc->lockedBy($path), 'the Comment still holds it');
		$this->nc->ocs('DELETE', "/comments/$comment");
		self::assertNull($this->nc->lockedBy($path), 'nothing is left');
	}

	public function testAReviewersCommentLocksThroughTheirLink(): void {
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $link['status'], json_encode($link['data']));
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['data']['token']);
		$reviewer->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$created = $reviewer->call('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 3, 'body' => 'like this frame']);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		self::assertSame('Deliver', $this->nc->lockedBy("{$this->root}/cut.mp4"));
		self::assertSame(423, $this->nc->davStatus('DELETE', "{$this->root}/cut.mp4"));

		self::assertSame(200, $reviewer->call('DELETE', "/api/comments/{$created['data']['id']}")['status']);
		self::assertNull($this->nc->lockedBy("{$this->root}/cut.mp4"));
	}

	public function testTheProjectSettingFreesAndLocks(): void {
		$path = "{$this->root}/cut.mp4";
		self::assertTrue($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['lockFiles'], 'on unless a Member switches it off');
		$this->comment();
		$this->setLock(false);
		self::assertNull($this->nc->lockedBy($path));
		$this->setLock(true);
		self::assertSame('Deliver', $this->nc->lockedBy($path));

		// Off, a Comment locks nothing
		$this->setLock(false);
		$this->nc->put("{$this->root}/other.mp4", 'not really a video');
		$this->nc->ocs('GET', "/projects/{$this->projectId}");
		$other = array_values(array_filter(
			$this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'],
			static fn (array $asset) => $asset['versions'][0]['name'] === 'other.mp4',
		))[0]['versions'][0]['id'];
		$this->member->ocs('POST', "/versions/$other/comments", ['inFrame' => 1, 'body' => 'hm']);
		self::assertNull($this->nc->lockedBy("{$this->root}/other.mp4"));
		$this->setLock(true);
		self::assertSame('Deliver', $this->nc->lockedBy("{$this->root}/other.mp4"), 'and on locks what has Comments now');
	}

	public function testDeletingTheProjectReleasesTheLockAndRestoringSetsItAgain(): void {
		$path = "{$this->root}/cut.mp4";
		$this->comment();
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/{$this->projectId}")['status']);
		self::assertNull($this->nc->lockedBy($path), 'its files can go to the trash meanwhile');
		self::assertSame(200, $this->nc->ocs('POST', "/deleted-projects/{$this->projectId}/restore")['status']);
		self::assertSame('Deliver', $this->nc->lockedBy($path));

		// A file that went to the trash in between is Missing and cannot be locked
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		self::assertSame(204, $this->nc->davStatus('DELETE', $path), 'while the Project is deleted, the trash takes it');
		self::assertSame(200, $this->nc->ocs('POST', "/deleted-projects/{$this->projectId}/restore")['status']);
		$this->nc->emptyTrash();
	}

	public function testDeletingForGoodFreesTheFile(): void {
		$path = "{$this->root}/cut.mp4";
		$this->comment();
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->ocs('DELETE', "/deleted-projects/{$this->projectId}");
		self::assertNull($this->nc->lockedBy($path));
		self::assertSame(204, $this->nc->davStatus('DELETE', $path));
	}

	public function testRemovingTheAssetFromDeliverFreesTheFile(): void {
		$this->comment();
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$this->assetId}")['status']);
		self::assertNull($this->nc->lockedBy("{$this->root}/cut.mp4"));
	}

	public function testDeliverDeletesAnAssetWithItsLockedFiles(): void {
		$path = "{$this->root}/cut.mp4";
		$this->comment();
		self::assertSame('Deliver', $this->nc->lockedBy($path));
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$this->assetId}/files")['status']);
		self::assertSame(404, $this->nc->davStatus('GET', $path), 'the file went to the trash');
		$this->nc->emptyTrash();
	}

	public function testDeliverRenamesALockedFileAndWebDavCannot(): void {
		$path = "{$this->root}/cut.mp4";
		$fileId = $this->nc->fileId($path);
		$this->comment();
		self::assertSame(423, $this->nc->davStatus('MOVE', $path, null, "{$this->root}/new.mp4"));

		self::assertSame(200, $this->nc->ocs('POST', "/files/$fileId/rename", ['name' => 'new.mp4'])['status']);
		self::assertSame($fileId, $this->nc->fileId("{$this->root}/new.mp4"));
		self::assertSame('new.mp4', $this->version()['name'], 'Deliver follows the rename');
		self::assertSame('Deliver', $this->nc->lockedBy("{$this->root}/new.mp4"), 'and it stays locked');

		$this->nc->put("{$this->root}/taken.mp4", 'x');
		self::assertSame(409, $this->nc->ocs('POST', "/files/$fileId/rename", ['name' => 'taken.mp4'])['status'], 'it never replaces a file of that name');
		self::assertSame(400, $this->nc->ocs('POST', "/files/$fileId/rename", ['name' => 'sub/dir.mp4'])['status']);
	}

	public function testAConfirmedReplaceKeepsTheVersionAndItsLock(): void {
		$path = "{$this->root}/cut.mp4";
		$fileId = $this->nc->fileId($path);
		$temp = "{$this->root}/.deliver-replace-1";
		$this->nc->put($temp, 'the new cut');
		$tempId = $this->nc->fileId($temp);

		// Without Comments there is nothing to ask about
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => $tempId])['status']);
		self::assertSame('the new cut', $this->nc->get($path));
		self::assertNull($this->version()['overwrittenAt'], 'no Comments, nothing to mark');

		$this->comment();
		$this->nc->put($temp, 'the newest cut');
		$tempId = $this->nc->fileId($temp);
		$refused = $this->nc->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => $tempId]);
		self::assertSame([409, 'confirm'], [$refused['status'], $refused['data']['reason'] ?? null], 'its Comments need a confirmation first');
		self::assertSame('the new cut', $this->nc->get($path));

		$before = time();
		$replaced = $this->nc->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => $tempId, 'confirm' => true]);
		self::assertSame(200, $replaced['status'], json_encode($replaced['data']));
		self::assertSame('the newest cut', $this->nc->get($path));
		self::assertSame($fileId, $this->nc->fileId($path), 'the same file id, so the same Version');
		self::assertSame(404, $this->nc->davStatus('GET', $temp), 'the temporary file is gone');
		self::assertGreaterThanOrEqual($before, $this->version()['overwrittenAt']);
		self::assertSame($this->versionId, $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id']);
		self::assertSame(['warmer please'], array_column($this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments'], 'body'), 'the Comments stay');
		self::assertSame('Deliver', $this->nc->lockedBy($path), 'and the file stays locked');
		self::assertSame([], $this->subjects($this->member), 'whoever confirmed it knows; nobody is told of it');
	}

	public function testAReplaceNeedsAFileNextToTheVersionsFile(): void {
		$this->nc->mkdir("{$this->root}/sub");
		$this->nc->put("{$this->root}/sub/.deliver-replace-2", 'elsewhere');
		$elsewhere = $this->nc->fileId("{$this->root}/sub/.deliver-replace-2");
		self::assertSame(400, $this->nc->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => $elsewhere])['status']);
		self::assertSame(404, $this->nc->ocs('POST', "/versions/{$this->versionId}/replace", ['fileId' => 999999999])['status']);
		self::assertSame('not really a video', $this->nc->get("{$this->root}/cut.mp4"));
	}

	public function testAnOverwriteWithoutTheLockMarksTheCommentsAndNotifiesTheMembers(): void {
		$path = "{$this->root}/cut.mp4";
		$this->setLock(false);
		$this->comment();
		self::assertNull($this->version()['overwrittenAt']);
		$this->member->ocsForm('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');
		$this->nc->ocsForm('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');

		$before = time();
		self::assertSame(204, $this->nc->davStatus('PUT', $path, 'a different cut'));
		self::assertGreaterThanOrEqual($before, $this->version()['overwrittenAt']);
		self::assertSame(['The file of cut, Version 1, was overwritten under its Comments'], $this->subjects($this->member));
		self::assertSame([], $this->subjects($this->nc), 'not the one who did it');
		self::assertCount(1, $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments'], 'the Comments stay');
	}

	public function testAnOverwriteOfAVersionWithoutCommentsMarksNothing(): void {
		$this->setLock(false);
		self::assertSame(204, $this->nc->davStatus('PUT', "{$this->root}/cut.mp4", 'a different cut'));
		self::assertNull($this->version()['overwrittenAt']);
		self::assertSame([], $this->subjects($this->member));
	}

	public function testTheReviewLinkKnowsTheOverwrite(): void {
		$this->setLock(false);
		$this->comment();
		$this->nc->davStatus('PUT', "{$this->root}/cut.mp4", 'a different cut');
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$context = $reviewer->call('GET', "/api/context?versionId={$this->versionId}")['data'];
		self::assertNotNull($context['versions'][0]['overwrittenAt'] ?? null);
		self::assertSame($this->version()['overwrittenAt'], $context['versions'][0]['overwrittenAt']);
		self::assertSame($this->version()['overwrittenAt'], $reviewer->call('GET', "/api/versions/{$this->versionId}/comments")['data']['overwrittenAt'], 'and the Comment list says it, to mark the Comments before');
	}
}
