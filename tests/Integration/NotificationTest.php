<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Notifications for Members and mail for Reviewers (spec: Notifications),
 * read back the way a person sees them: the notifications API and the dev
 * instance's Mailpit inbox.
 */
class NotificationTest extends TestCase {
	private NextcloudClient $admin;
	/** The owner of the Project, a user of its own in English, whatever language the admin speaks */
	private NextcloudClient $nc;
	private string $owner;
	private NextcloudClient $member;
	private string $user;
	private string $root;
	private int $projectId;
	private int $versionId;

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
		$this->versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];

		$this->user = 'deliver-member-' . bin2hex(random_bytes(4));
		$this->member = $this->englishUser($this->user);
		$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $this->user, 'permissions' => 31,
		]);
		$this->clearNotifications($this->nc);
	}

	private function englishUser(string $uid): NextcloudClient {
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		$this->admin->ocsForm('PUT', "/ocs/v2.php/cloud/users/$uid", ['key' => 'language', 'value' => 'en']);
		return $this->admin->withUser($uid, $password);
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->user}");
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->owner}");
	}

	private function clearNotifications(NextcloudClient $client): void {
		$client->ocsForm('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');
	}

	/** @return list<string> the subjects of Deliver's notifications for this person */
	private function subjects(NextcloudClient $client): array {
		$listed = $client->ocsForm('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications');
		return array_values(array_map(
			static fn (array $n) => $n['subject'],
			array_filter($listed['data'] ?? [], static fn (array $n) => $n['app'] === 'deliver'),
		));
	}

	public function testMembersHearOfCommentsVersionsAndMissingFiles(): void {
		$comment = $this->member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => 'warmer please']);
		self::assertSame(201, $comment['status'], json_encode($comment['data']));
		self::assertSame(["{$this->user} commented on cut, Version 1"], $this->subjects($this->nc));
		self::assertSame([], $this->subjects($this->member), 'nobody is told about their own Comment');

		$this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => 'will do', 'parentId' => $comment['data']['id']]);
		self::assertContains("{$this->owner} replied on cut, Version 1", $this->subjects($this->member));

		$this->nc->put("{$this->root}/cut_v2.mp4", 'not really a video');
		$this->nc->ocs('GET', "/projects/{$this->projectId}");
		self::assertContains('cut_v2.mp4 was stacked as Version 2 of cut, going by its name', $this->subjects($this->member));

		$this->nc->delete("{$this->root}/cut.mp4");
		self::assertContains('The file of cut, Version 1, is missing', $this->subjects($this->member));

		// A deleted Comment takes its notification along
		$this->nc->ocs('DELETE', "/comments/{$comment['data']['id']}");
		self::assertNotContains("{$this->user} commented on cut, Version 1", $this->subjects($this->nc));
	}

	public function testAMutedProjectStaysQuiet(): void {
		self::assertTrue($this->nc->ocs('PUT', "/projects/{$this->projectId}/mute", ['muted' => true])['data']['muted']);
		self::assertTrue($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['muted']);
		$this->member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => 'hello?']);
		self::assertSame([], $this->subjects($this->nc));

		$this->nc->ocs('PUT', "/projects/{$this->projectId}/mute", ['muted' => false]);
		$this->member->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 6, 'body' => 'hello again']);
		self::assertCount(1, $this->subjects($this->nc));
	}

	public function testAReviewerWithAnEmailHearsOfReplies(): void {
		$link = $this->nc->ocs('POST', "/files/{$this->nc->fileId($this->root)}/shares");
		self::assertTrue($link['data']['canMail'], 'the dev instance mails into Mailpit');
		$email = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['data']['token']);
		$reviewer->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => $email]);
		$question = $reviewer->call('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 3, 'body' => 'final grade?']);
		self::assertSame(201, $question['status'], json_encode($question['data']));

		$this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 3, 'body' => 'yes, final', 'parentId' => $question['data']['id']]);
		$found = json_decode((string)file_get_contents('http://mail:8025/api/v1/search?query=' . rawurlencode("to:$email")), true);
		self::assertSame(1, $found['messages_count'] ?? 0, 'one mail, to the Reviewer');
		$mail = json_decode((string)file_get_contents('http://mail:8025/api/v1/message/' . $found['messages'][0]['ID']), true);
		// In the language of whoever replied
		self::assertSame("{$this->owner} replied to your Comment", $mail['Subject']);
		self::assertStringContainsString('yes, final', $mail['Text']);
		self::assertStringContainsString("/s/{$link['data']['token']}?r=", $mail['Text'], 'with the Personal Link');
		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$link['data']['id']}");
	}
}
