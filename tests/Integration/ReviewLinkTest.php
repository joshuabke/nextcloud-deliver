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

	public function testAMemberOpeningTheLinkLandsInTheApp(): void {
		$page = $this->nc->request('GET', "/apps/deliver/s/{$this->token}/versions/{$this->versionId}");
		self::assertSame(303, $page['status'], 'a Member never reviews with reduced rights');
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
