<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Approvals (story 88) over the HTTP API: Members and Reviewers decide on a
 * Version, everyone sees who decided what, and a decision can be changed or
 * taken back.
 */
class ApprovalTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private int $versionId;
	/** @var list<string> */
	private array $users = [];

	protected function setUp(): void {
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		foreach ($this->users as $user) {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		$this->nc->delete($this->root);
	}

	/** A second account in English with the Project folder shared to it */
	private function member(int $permissions): array {
		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		$this->nc->ocsForm('PUT', "/ocs/v2.php/cloud/users/$user", ['key' => 'language', 'value' => 'en']);
		$this->users[] = $user;
		$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $user, 'permissions' => $permissions,
		]);
		return [$user, $this->nc->withUser($user, $password)];
	}

	private function decide(NextcloudClient $client, ?string $status): array {
		return $client->ocs('PUT', "/versions/{$this->versionId}/approval", ['status' => $status]);
	}

	public function testMembersDecideAndEveryoneSeesIt(): void {
		[$user, $member] = $this->member(1);
		$member->ocsForm('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');

		$decided = $this->decide($this->nc, 'approved');
		self::assertSame(200, $decided['status'], json_encode($decided['data']));
		self::assertSame([['admin', 'approved']], array_map(static fn ($a) => [$a['author']['id'], $a['status']], $decided['data']));

		// Reading the folder is enough to decide, as it is to comment
		$this->decide($member, 'changes');
		$listed = $member->ocs('GET', "/versions/{$this->versionId}/comments")['data']['approvals'];
		self::assertSame([['admin', 'approved'], [$user, 'changes']], array_map(static fn ($a) => [$a['author']['id'], $a['status']], $listed));

		// A decision changes in place, and goes away with no status
		self::assertCount(2, $this->decide($member, 'approved')['data']);
		self::assertSame(['admin'], array_map(static fn ($a) => $a['author']['id'], $this->decide($member, null)['data']));

		self::assertSame(400, $this->decide($this->nc, 'maybe')['status']);

		$notifications = $member->ocsForm('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications')['data'];
		self::assertContains('admin approved cut, Version 1', array_column($notifications, 'subject'));
	}

	public function testReviewersDecideOnlyWhereTheyMayComment(): void {
		$link = $this->nc->ocs('POST', "/files/{$this->nc->fileId($this->root)}/shares")['data'];
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);

		self::assertSame(403, $reviewer->call('PUT', "/api/versions/{$this->versionId}/approval", ['status' => 'approved'])['status'], 'no name yet');
		$reviewer->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$decided = $reviewer->call('PUT', "/api/versions/{$this->versionId}/approval", ['status' => 'changes']);
		self::assertSame(200, $decided['status'], json_encode($decided['data']));
		self::assertSame([['reviewer', 'Mara', 'changes']], array_map(static fn ($a) => [$a['author']['type'], $a['author']['name'], $a['status']], $decided['data']));

		$this->nc->ocs('PUT', "/shares/{$link['id']}", ['canComment' => false]);
		self::assertSame(403, $reviewer->call('PUT', "/api/versions/{$this->versionId}/approval", ['status' => 'approved'])['status']);
	}
}
