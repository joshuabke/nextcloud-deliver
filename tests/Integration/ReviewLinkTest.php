<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Reviewers on a Project Link (ADR 0011): they identify themselves with a
 * name or a Personal Link, and what they may do comes from the link and
 * from rights of their own.
 */
class ReviewLinkTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private int $versionId;
	private int $linkId;
	private string $token;

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
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		$this->versionId = $shown['data']['assets'][0]['versions'][0]['id'];

		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $link['status'], json_encode($link['data']));
		$this->linkId = $link['data']['id'];
		$this->token = $link['data']['token'];
		self::assertTrue($link['data']['review'], 'a new link is live');
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
	}

	private function reviewer(): PublicClient {
		return new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $this->token);
	}

	private function setFlags(array $flags): void {
		$updated = $this->nc->ocs('PUT', "/links/{$this->linkId}", $flags);
		self::assertSame(200, $updated['status'], json_encode($updated['data']));
	}

	/** @return array<string, mixed> the Comment as the Reviewer wrote it */
	private function comment(PublicClient $client, array $fields): array {
		$created = $client->call('POST', "/api/versions/{$this->versionId}/comments", $fields);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data'];
	}

	public function testTheWatermarkIsAFlagOfTheLink(): void {
		$context = fn () => $this->reviewer()->call('GET', '/api/context?versionId=' . $this->versionId)['data']['flags'];
		self::assertFalse($context()['watermark'], 'off unless asked for');
		$this->setFlags(['watermark' => true]);
		self::assertTrue($context()['watermark']);
		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['links'];
		self::assertTrue($listed[0]['watermark'], 'the link settings show the switch on');
	}

	public function testAReviewerAttachesToTheirComment(): void {
		$asReviewer = $this->reviewer();
		$asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$comment = $this->comment($asReviewer, ['inFrame' => 3, 'body' => 'like this frame']);

		$attached = $asReviewer->raw("/api/comments/{$comment['id']}/attachments", 'mood.jpg', 'jpeg bytes');
		self::assertSame(201, $attached['status'], $attached['body']);
		$id = json_decode($attached['body'], true)['attachments'][0]['id'];

		$fetched = $asReviewer->raw("/attachments/$id");
		self::assertSame([200, 'jpeg bytes'], [$fetched['status'], $fetched['body']]);
		self::assertSame(404, $asReviewer->raw('/attachments/999999999')['status']);
	}

	public function testANameSomeoneInTheReviewHasIsTaken(): void {
		$claim = fn (string $name) => $this->reviewer()->call('POST', '/api/reviewer', ['name' => $name])['status'];
		$owner = $this->nc->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['display-name'];
		self::assertSame(409, $claim($owner), 'not the name of the Member who shares it');
		self::assertSame(201, $claim('Mara'));
		self::assertSame(409, $claim(' mara '), 'nor that of another Reviewer, whatever the case');

		$elsewhere = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		self::assertSame(409, (new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $elsewhere['token']))->call('POST', '/api/reviewer', ['name' => 'Mara'])['status'], 'through another link of the Project too');

		// The same gate when the Member invites or renames
		$invite = fn (string $name) => $this->nc->ocs('POST', "/links/{$elsewhere['id']}/reviewers", ['name' => $name]);
		$refused = $invite('MARA');
		self::assertSame(409, $refused['status']);
		self::assertSame('Someone in this review is already called "MARA".', $refused['data']['message']);
		$jo = $invite('Jo')['data']['id'];
		self::assertSame(409, $this->nc->ocs('PUT', "/reviewers/$jo", ['name' => 'Mara'])['status']);
		self::assertSame(200, $this->nc->ocs('PUT', "/reviewers/$jo", ['name' => 'JO'])['status'], 'their own name stays theirs');
	}

	public function testANameIsTakenThroughAnotherMembersLinkToo(): void {
		$uid = 'deliver-colleague-' . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		try {
			$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $uid, 'permissions' => 31]);
			$theirs = $this->nc->withUser($uid, $password)->ocs('POST', "/projects/{$this->projectId}/links")['data']['token'];
			self::assertSame(201, $this->reviewer()->call('POST', '/api/reviewer', ['name' => 'Mara'])['status']);
			$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $theirs);
			self::assertSame(409, $visitor->call('POST', '/api/reviewer', ['name' => 'Mara'])['status'], 'one review, whichever Member shared it');
			self::assertSame(409, $visitor->call('POST', '/api/reviewer', ['name' => $uid])['status'], 'nor the name of a Member the files are shared with');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$uid");
		}
	}

	public function testReviewerNamesThemselvesBeforeCommenting(): void {
		$asReviewer = $this->reviewer();

		$context = $asReviewer->call('GET', '/api/context?versionId=' . $this->versionId);
		self::assertSame(200, $context['status'], json_encode($context['data']));
		self::assertSame('unnamed', $context['data']['me']['type'], 'nobody has said who they are yet');
		// The Review view asks for the name, rather than saying commenting is off
		$listed = $asReviewer->call('GET', "/api/versions/{$this->versionId}/comments");
		self::assertTrue($listed['data']['canComment'], 'commenting is on, once there is a name');
		self::assertSame('cut', $context['data']['asset']['name']);

		$refused = $asReviewer->call('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 10, 'body' => 'who am I']);
		self::assertSame(403, $refused['status'], 'a nameless visitor may read but not write');

		$claimed = $asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => 'mara@example.test']);
		self::assertSame(201, $claimed['status'], json_encode($claimed['data']));
		$key = $claimed['data']['key'];

		$comment = $this->comment($asReviewer, ['inFrame' => 40, 'body' => 'hold the logo longer']);
		self::assertSame(['reviewer', 'Mara'], [$comment['author']['type'], $comment['author']['name']]);

		// The Member sees the Reviewer's Comment with the name they gave
		$listed = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments");
		self::assertSame(['Mara'], array_column(array_column($listed['data']['comments'], 'author'), 'name'));

		// Reviewers touch their own and nothing else
		$mine = $asReviewer->call('PUT', "/api/comments/{$comment['id']}", ['body' => 'hold the logo a bit longer']);
		self::assertSame(200, $mine['status'], json_encode($mine['data']));

		$byMember = $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => 'noted']);
		self::assertSame(201, $byMember['status']);
		$theirs = $asReviewer->call('PUT', "/api/comments/{$byMember['data']['id']}", ['body' => 'not mine']);
		self::assertSame(403, $theirs['status'], 'a Reviewer never edits someone else\'s Comment');
		self::assertSame(403, $asReviewer->call('DELETE', "/api/comments/{$byMember['data']['id']}")['status']);

		// A Personal Link carries the identity to any other browser
		$onAnotherDevice = $asReviewer->otherDevice();
		self::assertSame('unnamed', $onAnotherDevice->call('GET', '/api/context?versionId=' . $this->versionId)['data']['me']['type']);
		$recognised = $onAnotherDevice->call('GET', "/api/context?versionId={$this->versionId}&r=$key");
		self::assertSame(['reviewer', 'Mara'], [$recognised['data']['me']['type'], $recognised['data']['me']['name']]);
		$fromThere = $this->comment($onAnotherDevice, ['inFrame' => 60, 'body' => 'from my laptop', 'r' => $key]);
		self::assertSame($comment['author']['id'], $fromThere['author']['id'], 'the same person, not a second Reviewer');
	}

	public function testLinkFlagsDecideWhatAReviewerMayDo(): void {
		$asReviewer = $this->reviewer();
		self::assertSame(201, $asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara'])['status']);
		$comment = $this->comment($asReviewer, ['inFrame' => 10, 'body' => 'first']);

		// Resolving is a Member's job: Deliver's public surface has no route for it
		self::assertSame(404, $asReviewer->call('PUT', "/api/comments/{$comment['id']}/resolved", ['resolved' => true])['status']);

		$this->setFlags(['canComment' => false]);
		$refused = $asReviewer->call('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 20, 'body' => 'still talking']);
		self::assertSame(403, $refused['status'], 'a read-only link takes no Comments');
		self::assertSame(200, $asReviewer->call('GET', "/api/versions/{$this->versionId}/comments")['status'], 'reading stays');
	}

	public function testAMemberInvitesAReviewerAndReissuesTheLinkLater(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Jo', 'email' => 'jo@example.test']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		self::assertStringEndsWith("/s/{$this->token}?r={$invited['data']['key']}", $invited['data']['link'], 'the link URL plus the key');

		$asJo = $this->reviewer();
		$context = $asJo->call('GET', "/api/context?versionId={$this->versionId}&r={$invited['data']['key']}");
		self::assertSame(['reviewer', 'Jo'], [$context['data']['me']['type'], $context['data']['me']['name']], 'identified from the first click');

		// The link is replaced; Jo keeps the identity through the new one
		$replacement = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $replacement['status']);
		$listed = $this->nc->ocs('GET', "/links/{$replacement['data']['id']}/reviewers");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		$jo = array_values(array_filter($listed['data'], static fn (array $each) => $each['name'] === 'Jo'))[0];
		self::assertStringContainsString("/s/{$replacement['data']['token']}?r=", $jo['link']);
	}

	public function testAMemberPreviewsTheLinkButReviewsInTheApp(): void {
		$mara = $this->reviewer();
		$key = $mara->call('POST', '/api/reviewer', ['name' => 'Mara'])['data']['key'];
		$theirs = $this->comment($mara, ['inFrame' => 2, 'body' => 'Mara wrote this']);

		// The Member tries the Personal Link they are about to send
		$page = $this->nc->request('GET', "/apps/deliver/s/{$this->token}/versions/{$this->versionId}?r=$key");
		self::assertSame(200, $page['status'], 'the page shows what Reviewers see');
		preg_match('/id="initial-state-deliver-link" value="([^"]+)"/', $page['body'], $state);
		self::assertNull(json_decode(base64_decode($state[1]), true)['reviewer'], 'not as the Reviewer whose link it is');

		$cookie = 'Cookie: ' . rawurlencode('deliver_reviewer_' . $this->token) . '=' . rawurlencode($key);
		$api = fn (string $method, string $path, array $json = []) => $this->nc->request($method, "/apps/deliver/s/{$this->token}$path", $json === [] ? null : json_encode($json), ['Content-Type: application/json', 'Accept: application/json', $cookie]);
		$context = json_decode($api('GET', "/api/context?versionId={$this->versionId}")['body'], true);
		self::assertSame(['member', false], [$context['me']['type'], $context['flags']['canComment']], 'read only, as a Member and not as a Reviewer');
		self::assertStringEndsWith("/apps/deliver/versions/{$this->versionId}", $context['me']['url'], 'with the way into the app');
		self::assertSame(403, $api('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'from the preview'])['status']);
		self::assertSame(403, $api('PUT', "/api/comments/{$theirs['id']}", ['body' => 'not Mara'])['status'], 'nor touches the Reviewer\'s Comments');
		self::assertSame(403, $api('DELETE', "/api/comments/{$theirs['id']}")['status']);
		self::assertSame(['seenUntil' => 0], json_decode($api('POST', "/api/versions/{$this->versionId}/seen")['body'], true), 'nor moves their Unseen mark');
		self::assertSame(403, $api('POST', '/api/reviewer', ['name' => 'Me'])['status'], 'a Member never becomes a Reviewer of their own link');
		self::assertSame([], $this->nc->ocs('GET', "/links/{$this->linkId}/activity")['data'], 'a preview is no activity, and no visit of the Reviewer');
	}

	public function testMembershipFollowsEachVersionsFile(): void {
		$this->nc->put("{$this->root}/teaser.mp4", 'not really a video');
		$assets = array_column($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], null, 'name');
		$teaser = $assets['teaser']['versions'][0]['id'];
		$uid = 'deliver-colleague-' . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		$colleague = $this->nc->withUser($uid, $password);
		try {
			// They can open the teaser, but not the cut they are asked to review
			$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}/teaser.mp4", 'shareType' => 0, 'shareWith' => $uid, 'permissions' => 1]);
			$api = fn (string $method, string $path, array $json = []) => json_decode($colleague->request($method, "/apps/deliver/s/{$this->token}$path", $json === [] ? null : json_encode($json), ['Content-Type: application/json', 'Accept: application/json'])['body'], true);

			self::assertSame('member', $api('GET', "/api/context?versionId=$teaser")['me']['type'], 'a preview of the file they can open');
			$cut = $api('GET', "/api/context?versionId={$this->versionId}");
			self::assertSame(['unnamed', true], [$cut['me']['type'], $cut['flags']['canComment']], 'and a Reviewer of the one they cannot');
			$key = $api('POST', '/api/reviewer', ['name' => 'Colleague'])['key'] ?? null;
			self::assertNotNull($key, 'who can open only some of the link names themselves');
			self::assertSame('Colleague', $api('POST', "/api/versions/{$this->versionId}/comments", ['inFrame' => 4, 'body' => 'from outside', 'r' => $key])['author']['name']);
			self::assertSame(403, $colleague->request('POST', "/apps/deliver/s/{$this->token}/api/versions/$teaser/comments", json_encode(['inFrame' => 4, 'body' => 'from the preview', 'r' => $key]), ['Content-Type: application/json'])['status'], 'and comments on their own file in Deliver');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$uid");
		}
	}

	public function testAMemberEditsAReviewerAndRenewsTheirLink(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim']);
		$id = $invited['data']['id'];
		$edited = $this->nc->ocs('PUT', "/reviewers/$id", ['name' => 'Kim Kunde', 'email' => 'kim@example.com', 'mailVersions' => true]);
		self::assertSame(200, $edited['status'], json_encode($edited['data']));
		self::assertSame(['Kim Kunde', 'kim@example.com', true], [$edited['data']['name'], $edited['data']['email'], $edited['data']['mail']['versions']]);

		$renewed = $this->nc->ocs('POST', "/reviewers/$id/key");
		self::assertSame(200, $renewed['status'], json_encode($renewed['data']));
		self::assertNotSame($invited['data']['key'], $renewed['data']['key']);
		$old = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $this->token);
		self::assertSame('unnamed', $old->call('GET', "/api/context?versionId={$this->versionId}&r=" . $invited['data']['key'])['data']['me']['type'], 'the old Personal Link names nobody any more');
	}

	public function testAMemberRemovesAReviewerWhoseCommentsStay(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim']);
		$id = $invited['data']['id'];
		$this->comment($this->reviewer(), ['inFrame' => 0, 'body' => 'Kim was here', 'r' => $invited['data']['key']]);

		self::assertSame(200, $this->nc->ocs('DELETE', "/reviewers/$id")['status']);
		self::assertNotContains($id, array_column($this->nc->ocs('GET', "/links/{$this->linkId}/reviewers")['data'], 'id'));
		self::assertSame([], $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['reviewers']);
		self::assertSame('unnamed', $this->reviewer()->call('GET', "/api/context?versionId={$this->versionId}&r=" . $invited['data']['key'])['data']['me']['type'], 'the Personal Link names nobody any more');
		$comments = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments'];
		self::assertSame(['reviewer', 'Kim'], [$comments[0]['author']['type'], $comments[0]['author']['name']], 'their Comments keep their name');
	}

	public function testAMemberDeletesAReviewLink(): void {
		self::assertSame(200, $this->nc->ocs('DELETE', "/links/{$this->linkId}")['status']);
		self::assertSame([], $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['links']);
		self::assertSame(404, $this->reviewer()->call('GET', '/api/assets')['status'], 'the link stops working for everyone');
	}

	public function testAReviewersOwnRightsGoOverThoseOfTheLink(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim']);
		$key = $invited['data']['key'];
		$asKim = $this->reviewer();
		$post = fn () => $asKim->call('POST', "/api/versions/{$this->versionId}/comments?r=$key", ['inFrame' => 1, 'body' => 'hi'])['status'];
		$rights = fn (array $rights) => $this->nc->ocs('PUT', "/reviewers/{$invited['data']['id']}", ['name' => 'Kim', 'rights' => $rights]);

		self::assertSame(201, $post(), 'the link lets Reviewers comment');
		self::assertSame([false, null], [$rights(['canComment' => false])['data']['rights']['canComment'], $rights(['canComment' => false])['data']['rights']['watermark']]);
		self::assertSame(403, $post(), 'Kim may not, whatever the link says');
		self::assertFalse($asKim->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['flags']['canComment']);

		$this->setFlags(['canComment' => false]);
		$rights(['canComment' => true, 'watermark' => true]);
		self::assertSame(201, $post(), 'Kim may, though the link does not let anyone else');
		self::assertTrue($asKim->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['flags']['watermark']);

		$rights([]);
		self::assertSame(403, $post(), 'without rights of their own, the link decides again');
	}
}
