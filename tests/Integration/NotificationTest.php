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

	public function testAMentionReachesTheMemberEvenWhenMuted(): void {
		$this->member->ocs('PUT', "/projects/{$this->projectId}/mute", ['muted' => true]);
		$this->admin->ocsForm('PUT', "/ocs/v2.php/cloud/users/{$this->user}", ['key' => 'displayname', 'value' => 'Mara Member']);
		// Who can open the file, not who can reach a folder (ADR 0009)
		$members = $this->nc->ocs('GET', "/versions/{$this->versionId}/members")['data'];
		self::assertEqualsCanonicalizing([$this->owner, $this->user], array_column($members, 'id'));

		$comment = $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 2, 'body' => "@{$this->user} please check the logo, @admin"]);
		self::assertSame(201, $comment['status'], json_encode($comment['data']));
		self::assertSame([$this->user => 'Mara Member'], (array)$comment['data']['mentions'], 'names of Members only, never of other accounts');
		self::assertSame(["{$this->owner} mentioned you on cut, Version 1"], $this->subjects($this->member), 'a mention, not also a Comment');

		$edl = $this->nc->request('GET', "/index.php/apps/deliver/versions/{$this->versionId}/export/edl")['body'];
		self::assertStringContainsString('@Mara Member please check the logo', $edl, 'exports show the name');
	}

	public function testMembersAreRemindedOfADueDateOnce(): void {
		$assetId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['id'];
		self::assertSame(400, $this->nc->ocs('PUT', "/assets/$assetId", ['dueDate' => '2026-02-30'])['status']);

		$set = $this->nc->ocs('PUT', "/assets/$assetId", ['dueDate' => date('Y-m-d')]);
		self::assertSame([200, date('Y-m-d')], [$set['status'], $set['data']['dueDate']]);
		self::assertSame(date('Y-m-d'), $this->nc->ocs('GET', "/versions/{$this->versionId}")['data']['asset']['dueDate']);

		$this->runReminders();
		$this->runReminders();
		self::assertSame(['cut is due today'], $this->subjects($this->member), 'once, not every hour');
	}

	private function runReminders(): void {
		exec("php /var/www/html/occ background-job:list --class='OCA\\Deliver\\BackgroundJob\\RemindDueDates' --output=json", $listed);
		$job = json_decode(implode('', $listed), true)[0]['id'];
		exec("php /var/www/html/occ background-job:execute $job --force-execute 2>&1");
	}

	public function testAReviewerChoosesWhatIsMailed(): void {
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$email = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$claimed = $reviewer->call('POST', '/api/reviewer', ['name' => 'Kim', 'email' => $email, 'mailComments' => true]);
		self::assertSame(['replies' => true, 'comments' => true, 'versions' => false], $claimed['data']['mail']);

		$this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'grade is final']);
		self::assertSame(["{$this->owner} commented on cut.mp4", 'Your Personal Link to the review'], $this->subjectsTo($email), 'every Comment, as asked');

		$changed = $reviewer->call('PUT', '/api/reviewer', ['email' => $email, 'mailComments' => false, 'mailVersions' => true]);
		self::assertSame(['replies' => true, 'comments' => false, 'versions' => true], $changed['data']['mail']);
		$this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 2, 'body' => 'one more']);
		$this->nc->put("{$this->root}/cut_v2.mp4", 'not really a video');
		$this->nc->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(['Version 2 of cut_v2.mp4 is ready for review', "{$this->owner} commented on cut.mp4", 'Your Personal Link to the review'], $this->subjectsTo($email));
		self::assertSame(403, (new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']))->call('PUT', '/api/reviewer', ['mailVersions' => false])['status'], 'only as the Reviewer');
	}

	public function testAReviewerWithAnEmailGetsTheirPersonalLinkByMail(): void {
		$token = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data']['token'];
		$email = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$claimed = (new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $token))->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => $email]);
		self::assertTrue($claimed['data']['mailed']);

		$found = json_decode((string)file_get_contents('http://mail:8025/api/v1/search?query=' . rawurlencode("to:$email")), true);
		self::assertSame(['Your Personal Link to the review'], array_column($found['messages'] ?? [], 'Subject'));
		$mail = json_decode((string)file_get_contents('http://mail:8025/api/v1/message/' . $found['messages'][0]['ID']), true);
		self::assertStringContainsString($claimed['data']['link'], $mail['Text']);

		$withoutAddress = (new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $token))->call('POST', '/api/reviewer', ['name' => 'Kim']);
		self::assertFalse($withoutAddress['data']['mailed'], 'the link is shown to bookmark instead');
	}

	public function testAMemberMailsAnInvitedReviewerTheirPersonalLink(): void {
		$linkId = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data']['id'];
		$quiet = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$invited = $this->nc->ocs('POST', "/links/$linkId/reviewers", ['name' => 'Jo', 'email' => $quiet]);
		self::assertFalse($invited['data']['mailed']);
		self::assertSame([], $this->subjectsTo($quiet), 'only when the Member asks');

		$email = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$invited = $this->nc->ocs('POST', "/links/$linkId/reviewers", ['name' => 'Kim', 'email' => $email, 'sendMail' => true, 'message' => "Hi Kim,\n\nthe first cut is up."]);
		self::assertTrue($invited['data']['mailed']);
		$found = json_decode((string)file_get_contents('http://mail:8025/api/v1/search?query=' . rawurlencode("to:$email")), true);
		self::assertSame(["{$this->owner} invites you to a review"], array_column($found['messages'] ?? [], 'Subject'));
		$mail = json_decode((string)file_get_contents('http://mail:8025/api/v1/message/' . $found['messages'][0]['ID']), true);
		self::assertStringContainsString('the first cut is up.', $mail['Text']);
		self::assertStringContainsString($invited['data']['link'], $mail['Text']);
	}

	/** @return list<string> subjects of the mails to one address, newest first */
	private function subjectsTo(string $email): array {
		$found = json_decode((string)file_get_contents('http://mail:8025/api/v1/search?query=' . rawurlencode("to:$email")), true);
		return array_column($found['messages'] ?? [], 'Subject');
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
		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertTrue($link['data']['canMail'], 'the dev instance mails into Mailpit');
		$email = 'reviewer-' . bin2hex(random_bytes(4)) . '@example.test';
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['data']['token']);
		$reviewer->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => $email]);
		$question = $reviewer->call('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 3, 'body' => 'final grade?']);
		self::assertSame(201, $question['status'], json_encode($question['data']));

		$this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 3, 'body' => 'yes, final', 'parentId' => $question['data']['id']]);
		$found = json_decode((string)file_get_contents('http://mail:8025/api/v1/search?query=' . rawurlencode("to:$email")), true);
		self::assertSame(2, $found['messages_count'] ?? 0, 'the Personal Link, then the Reply');
		$mail = json_decode((string)file_get_contents('http://mail:8025/api/v1/message/' . $found['messages'][0]['ID']), true);
		// In the language of whoever replied
		self::assertSame("{$this->owner} replied to your Comment", $mail['Subject']);
		self::assertStringContainsString('yes, final', $mail['Text']);
		// On the instance's own address, whichever address the reply came through
		$base = rtrim((string)shell_exec('php /var/www/html/occ config:system:get overwrite.cli.url'));
		self::assertStringContainsString("$base/apps/deliver/s/{$link['data']['token']}/versions/{$this->versionId}?r=", $mail['Text'], 'straight into the Review view, as that Reviewer');
	}
}
