<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Review through a Nextcloud Share Link (ADR 0004): the link is an ordinary
 * share until a Member switches review on, Reviewers identify themselves with
 * a name, and what they may do comes from the share, not from Deliver.
 */
class ShareReviewTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private int $versionId;
	private int $shareId;
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

		$link = $this->nc->ocs('POST', "/files/{$this->nc->fileId($this->root)}/shares");
		self::assertSame(201, $link['status'], json_encode($link['data']));
		$this->shareId = $link['data']['id'];
		$this->token = $link['data']['token'];
		self::assertTrue($link['data']['review'], 'the button in Deliver hands out a link with review on');
	}

	protected function tearDown(): void {
		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$this->shareId}");
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
	}

	private function reviewer(): PublicClient {
		return new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $this->token);
	}

	private function setFlags(array $flags): void {
		$updated = $this->nc->ocs('PUT', "/shares/{$this->shareId}", $flags);
		self::assertSame(200, $updated['status'], json_encode($updated['data']));
	}

	/** @return array<string, mixed> the Comment as the Reviewer wrote it */
	private function comment(PublicClient $client, array $fields): array {
		$created = $client->call('POST', "/api/versions/{$this->versionId}/comments", $fields);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data'];
	}

	public function testAnOrdinaryShareLinkIsNoReviewSurface(): void {
		$plain = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}",
			'shareType' => 3,
		]);
		self::assertSame(200, $plain['status'], json_encode($plain['data']));
		$plainToken = $plain['data']['token'];

		$asVisitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $plainToken);
		self::assertSame(404, $asVisitor->page(), 'sharing a file that is enabled in Deliver stays an ordinary share');
		self::assertSame(404, $asVisitor->call('GET', '/api/context?versionId=' . $this->versionId)['status']);

		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$plain['data']['id']}");
	}

	public function testReviewCanBeSwitchedOffAgain(): void {
		self::assertSame(200, $this->reviewer()->page(), 'review is on, so the page opens');

		$this->setFlags(['review' => false]);
		self::assertSame(404, $this->reviewer()->page(), 'switched off, the same link shows nothing of Deliver');
		self::assertSame(404, $this->reviewer()->call('GET', '/api/context?versionId=' . $this->versionId)['status']);

		$this->setFlags(['review' => true]);
		self::assertSame(200, $this->reviewer()->page());
	}

	public function testTheWatermarkIsAFlagOfTheLink(): void {
		$context = fn () => $this->reviewer()->call('GET', '/api/context?versionId=' . $this->versionId)['data']['flags'];
		self::assertFalse($context()['watermark'], 'off unless asked for');
		$this->setFlags(['watermark' => true]);
		self::assertTrue($context()['watermark']);
		$listed = $this->nc->ocs('GET', "/files/{$this->nc->fileId($this->root)}/shares")['data'];
		self::assertTrue($listed[0]['watermark'], 'the sidebar shows the switch on');
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

	public function testShareFlagsDecideWhatAReviewerMayDo(): void {
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

	public function testAPasswordOnTheShareGuardsTheReviewViewToo(): void {
		$protected = $this->nc->ocsForm('PUT', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$this->shareId}", [
			'password' => 'Review-' . bin2hex(random_bytes(6)),
		]);
		self::assertSame(200, $protected['status'], json_encode($protected['data']));

		$asReviewer = $this->reviewer();
		self::assertSame(303, $asReviewer->page(), 'the page sends the Reviewer to the share\'s password prompt');
		self::assertSame(404, $asReviewer->call('GET', '/api/context?versionId=' . $this->versionId)['status'], 'the API answers nothing until the password is given');
	}

	public function testVersionsOutsideTheShareStayOutside(): void {
		$this->nc->mkdir("{$this->root}/scenes");
		$this->nc->put("{$this->root}/scenes/intro.mp4", 'not really a video');
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		$stacks = array_column($shown['data']['assets'], 'versions', 'name');
		$introVersion = $stacks['intro'][0]['id'];

		$sub = $this->nc->ocs('POST', "/files/{$this->nc->fileId("{$this->root}/scenes")}/shares");
		self::assertSame(201, $sub['status'], json_encode($sub['data']));
		$asReviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $sub['data']['token']);

		self::assertSame(200, $asReviewer->call('GET', "/api/context?versionId=$introVersion")['status'], 'what the link shows is reachable');
		self::assertSame(404, $asReviewer->call('GET', "/api/context?versionId={$this->versionId}")['status'], 'what it does not show is not');

		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$sub['data']['id']}");
	}

	public function testAMemberInvitesAReviewerAndReissuesTheLinkLater(): void {
		$invited = $this->nc->ocs('POST', "/shares/{$this->shareId}/reviewers", ['name' => 'Jo', 'email' => 'jo@example.test']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		self::assertStringEndsWith("/s/{$this->token}?r={$invited['data']['key']}", $invited['data']['link'], 'the share URL plus the key');

		$asJo = $this->reviewer();
		$context = $asJo->call('GET', "/api/context?versionId={$this->versionId}&r={$invited['data']['key']}");
		self::assertSame(['reviewer', 'Jo'], [$context['data']['me']['type'], $context['data']['me']['name']], 'identified from the first click');

		// The link is replaced; Jo keeps the identity through the new one
		$replacement = $this->nc->ocs('POST', "/files/{$this->nc->fileId($this->root)}/shares");
		self::assertSame(201, $replacement['status']);
		$listed = $this->nc->ocs('GET', "/shares/{$replacement['data']['id']}/reviewers");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		$jo = array_values(array_filter($listed['data'], static fn (array $each) => $each['name'] === 'Jo'))[0];
		self::assertStringContainsString("/s/{$replacement['data']['token']}?r=", $jo['link']);
		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$replacement['data']['id']}");
	}

	public function testAMemberOpeningTheLinkLandsInTheApp(): void {
		$page = $this->nc->request('GET', "/apps/deliver/s/{$this->token}/versions/{$this->versionId}");
		self::assertSame(303, $page['status'], 'a Member never reviews with reduced rights');
	}

	public function testHiddenDownloadsKeepTheShareFromHandingOutTheOriginal(): void {
		$open = $this->reviewer()->call('GET', '/api/context?versionId=' . $this->versionId);
		self::assertStringContainsString('/public.php/dav/files/', $open['data']['versions'][0]['url']);

		$hidden = $this->nc->ocsForm('PUT', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$this->shareId}", ['hideDownload' => 'true']);
		self::assertSame(200, $hidden['status'], json_encode($hidden['data']));
		$context = $this->reviewer()->call('GET', '/api/context?versionId=' . $this->versionId);
		self::assertFalse($context['data']['flags']['canDownload']);
		$url = (string)$context['data']['versions'][0]['url'];
		self::assertStringContainsString('/media/', $url, 'without a Proxy the original still plays, but through Deliver');
		self::assertStringNotContainsString('/dav/', $url);
	}

	public function testAProjectListsItsLinksAndWhoCameByThem(): void {
		$fileLink = $this->nc->ocs('POST', "/files/{$this->nc->fileId("{$this->root}/cut.mp4")}/shares");
		self::assertSame(201, $fileLink['status'], json_encode($fileLink['data']));
		$invited = $this->nc->ocs('POST', "/shares/{$this->shareId}/reviewers", ['name' => 'Kim']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		// A Reviewer who names themselves on the file's link came by that one
		$walkIn = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $fileLink['data']['token']);
		self::assertSame(201, $walkIn->call('POST', '/api/reviewer', ['name' => 'Lea'])['status']);

		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/shares");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		$links = array_column($listed['data']['links'], null, 'id');
		self::assertSame([$this->root, true], [$links[$this->shareId]['name'], $links[$this->shareId]['isProject']]);
		self::assertSame(['cut.mp4', false, '/' . $this->root], [$links[$fileLink['data']['id']]['name'], $links[$fileLink['data']['id']]['isProject'], $links[$fileLink['data']['id']]['dir']]);

		$reviewers = array_column($listed['data']['reviewers'], null, 'name');
		self::assertSame([$reviewers['Kim']['id']], $links[$this->shareId]['reviewerIds'], 'invited through the folder link');
		self::assertSame([$reviewers['Lea']['id']], $links[$fileLink['data']['id']]['reviewerIds'], 'named themselves on the file link');
		$kimLinks = array_column($reviewers['Kim']['links'], 'url', 'shareId');
		self::assertStringContainsString($fileLink['data']['token'], $kimLinks[$fileLink['data']['id']], 'every Reviewer has a Personal Link through every review link');
	}

	public function testAMemberEditsAReviewerAndRenewsTheirLink(): void {
		$invited = $this->nc->ocs('POST', "/shares/{$this->shareId}/reviewers", ['name' => 'Kim']);
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

}
