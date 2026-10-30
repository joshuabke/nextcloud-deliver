<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Reviewers on a Review Link (ADR 0011): they identify themselves with a
 * name or a Personal Link, and what they may do comes from the link and
 * from rights of their own.
 */
class ReviewerTest extends TestCase {
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
		$this->nc->deleteProject($this->projectId);
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

	public function testAReviewerCopiesTheirPersonalLinkFromTheirMenu(): void {
		$asReviewer = $this->reviewer();
		$claimed = $asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara'])['data'];

		// The browser holds the key in its cookie already; the menu copies the link around it (story 128)
		$link = $asReviewer->call('GET', '/api/context?versionId=' . $this->versionId)['data']['me']['link'];
		self::assertSame($claimed['link'], $link);
		$key = substr($link, strpos($link, '?r=') + 3);
		$me = $asReviewer->otherDevice()->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['me'];
		self::assertSame(['reviewer', 'Mara'], [$me['type'], $me['name']], 'and it makes them Mara on another device');
	}

	public function testNamingOneselfAsSomeoneInTheReview(): void {
		// The Member's Reviewers outlive the test, so each run has addresses of its own
		$run = bin2hex(random_bytes(4));
		$mara = "mara-$run@example.test";
		$claim = fn (string $name, ?string $email = null) => $this->reviewer()->call('POST', '/api/reviewer', ['name' => $name, 'email' => $email]);
		$owner = $this->nc->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['display-name'];
		self::assertSame(409, $claim($owner)['status'], 'not the name of the Member who shares it');

		// As on Frame.io: the same name and address lead back to that Reviewer, through their mailbox only; another address makes another Reviewer of the same name
		$first = $claim('Mara', $mara)['data'];
		$again = $claim(' mara ', strtoupper($mara));
		self::assertSame([202, true], [$again['status'], $again['data']['mailed']]);
		self::assertArrayNotHasKey('key', $again['data'], 'name and address are no secret, so they never hand out the key');
		$otherBrowser = $this->reviewer();
		$other = $otherBrowser->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => "other-$run@example.test"]);
		self::assertSame(201, $other['status']);
		self::assertNotSame($first['id'], $other['data']['id']);
		self::assertSame(409, $otherBrowser->call('PUT', '/api/reviewer', ['email' => ucfirst($mara)])['status'], 'never two Reviewers of one address');
		self::assertNotSame($first['id'], $claim('Mara')['data']['id'], 'without an address, nobody becomes someone else');

		$elsewhere = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];

		// A Member invites or renames into a name nobody in the review has
		$invite = fn (string $name) => $this->nc->ocs('POST', "/links/{$elsewhere['id']}/reviewers", ['name' => $name]);
		$refused = $invite('MARA');
		self::assertSame(409, $refused['status']);
		self::assertSame('Someone in this review is already called "MARA".', $refused['data']['message']);
		$jo = $invite('Jo')['data']['id'];
		self::assertSame(409, $this->nc->ocs('PUT', "/reviewers/$jo", ['name' => 'Mara'])['status']);
		self::assertSame(200, $this->nc->ocs('PUT', "/reviewers/$jo", ['name' => 'JO'])['status'], 'their own name stays theirs');
	}

	public function testAReviewerRenamesThemselvesAndEndsTheirSession(): void {
		$kim = 'kim-' . bin2hex(random_bytes(4)) . '@example.test';
		$other = $this->reviewer();
		$other->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$asReviewer = $this->reviewer();
		$key = $asReviewer->call('POST', '/api/reviewer', ['name' => 'Kim', 'email' => $kim])['data']['key'];

		$renamed = $asReviewer->call('PUT', '/api/reviewer', ['name' => 'Kim Kunde', 'email' => $kim]);
		self::assertSame([200, 'Kim Kunde', $kim], [$renamed['status'], $renamed['data']['name'], $renamed['data']['email']]);
		$owner = $this->nc->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['display-name'];
		self::assertSame(409, $asReviewer->call('PUT', '/api/reviewer', ['name' => $owner, 'email' => $kim])['status'], 'not to a Member\'s name');
		self::assertSame('mara', $asReviewer->call('PUT', '/api/reviewer', ['name' => 'mara', 'email' => $kim])['data']['name'], 'another Reviewer\'s, told apart by the colour');
		$asReviewer->call('PUT', '/api/reviewer', ['name' => 'Kim Kunde', 'email' => $kim]);
		self::assertSame('Kim Kunde', $asReviewer->call('PUT', '/api/reviewer', ['email' => $kim])['data']['name'], 'no name keeps it');

		// This browser knows them through a second link of the Project they are on too
		$secondLink = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$second = $secondLink['token'];
		$secondKey = $this->nc->ocs('POST', "/links/{$secondLink['id']}/reviewers", ['name' => 'Kim', 'email' => $kim])['data']['key'];
		self::assertSame(200, $asReviewer->through($second)->raw("?r=$secondKey")['status']);
		self::assertSame('reviewer', $asReviewer->through($second)->call('GET', '/api/context?versionId=' . $this->versionId)['data']['me']['type']);
		self::assertSame(200, $asReviewer->call('DELETE', '/api/reviewer')['status']);
		$me = fn (string $query = '') => $asReviewer->call('GET', '/api/context?versionId=' . $this->versionId . $query)['data']['me'];
		self::assertSame('unnamed', $me()['type'], 'this browser forgot them');
		self::assertSame('unnamed', $asReviewer->through($second)->call('GET', '/api/context?versionId=' . $this->versionId)['data']['me']['type'], 'through every link');
		self::assertSame(['reviewer', 'Kim Kunde'], [$me("&r=$key")['type'], $me("&r=$key")['name']], 'their Personal Link still works');
	}

	public function testAnAddressIsOneReviewerInAProject(): void {
		$run = bin2hex(random_bytes(4));
		$leon = "leon-$run@example.test";
		$invite = fn (int $linkId, string $name, ?string $email) => $this->nc->ocs('POST', "/links/$linkId/reviewers", ['name' => $name, 'email' => $email])['data'];
		$first = $invite($this->linkId, 'Leon Green', $leon);
		$still = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];

		$again = $invite($still['id'], 'Leon', strtoupper($leon));
		self::assertSame([$first['id'], 'Leon Green'], [$again['id'], $again['name']], 'an invitation with a known address gives them the link too, under the name they have');
		self::assertStringContainsString($still['token'] . '?r=', $again['link']);
		self::assertNotSame($first['key'], $again['key'], 'with a key of its own (ADR 0014)');
		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data'];
		self::assertSame(['Leon Green'], array_column($listed['reviewers'], 'name'), 'listed once');
		self::assertSame([[$first['id']], [$first['id']]], array_column($listed['links'], 'reviewerIds'), 'under both links');

		$named = $this->reviewer()->call('POST', '/api/reviewer', ['name' => 'L. Green', 'email' => $leon]);
		self::assertSame([202, true], [$named['status'], $named['data']['mailed']], 'naming oneself with a known address, under any name, mails that Reviewer their Personal Link');

		$mo = $invite($this->linkId, 'Mo', "mo-$run@example.test");
		$taken = $this->nc->ocs('PUT', "/reviewers/{$mo['id']}", ['name' => 'Mo', 'email' => $leon]);
		self::assertSame([409, "Someone in this review already has the address $leon."], [$taken['status'], $taken['data']['message']], 'a Member cannot give one address to two Reviewers');
		$asMo = $this->reviewer();
		$asMo->raw('?r=' . $mo['key']);
		self::assertSame(409, $asMo->call('PUT', '/api/reviewer', ['email' => $leon])['status'], 'nor can a Reviewer take one');
	}

	public function testAPersonalLinkOpensOnlyTheLinksTheReviewerIsOn(): void {
		$run = bin2hex(random_bytes(4));
		$kim = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim', 'email' => "kim-$run@example.test"])['data'];
		$other = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$me = fn (PublicClient $client) => $client->call('GET', "/api/context?versionId={$this->versionId}&r={$kim['key']}")['data']['me']['type'];

		self::assertSame('reviewer', $me($this->reviewer()));
		$elsewhere = $this->reviewer()->through($other['token']);
		self::assertSame('unnamed', $me($elsewhere), 'not through a link of the Project they are not on');
		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data'];
		self::assertSame([$this->token], array_column($listed['reviewers'][0]['links'], 'token'), 'their Personal Links are those of their links');
		self::assertSame([], $this->nc->ocs('GET', "/links/{$other['id']}/reviewers")['data'], 'nor does the other link list them');

		$named = $elsewhere->call('POST', '/api/reviewer', ['name' => 'Kim N.', 'email' => "kim-$run@example.test"]);
		self::assertSame([202, true], [$named['status'], $named['data']['mailed']], 'naming themselves there mails them the Personal Link for it');
		$mailed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['reviewers'][0]['links'];
		$throughOther = array_values(array_filter($mailed, static fn (array $each) => $each['token'] === $other['token']))[0]['url'];
		self::assertSame('reviewer', $this->reviewer()->through($other['token'])->call('GET', "/api/context?versionId={$this->versionId}&r=" . substr($throughOther, strpos($throughOther, '?r=') + 3))['data']['me']['type'], 'which then opens it');
		self::assertSame([[$kim['id']], [$kim['id']]], array_column($this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['links'], 'reviewerIds'));
	}

	public function testEachPersonalLinkHasAKeyOfItsOwn(): void {
		$run = bin2hex(random_bytes(4));
		$jane = "jane-$run@example.test";
		$me = fn (string $token, string $key) => $this->reviewer()->through($token)->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['me']['type'];

		// Someone with this link names themselves with Jane's address, and gets a key
		$claimed = $this->reviewer()->call('POST', '/api/reviewer', ['name' => 'Jane Doe', 'email' => $jane]);
		self::assertSame(201, $claimed['status'], json_encode($claimed['data']));

		// The Member invites Jane's address on another link: the same Reviewer, but a key only that invitation hands out (ADR 0014)
		$final = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$invited = $this->nc->ocs('POST', "/links/{$final['id']}/reviewers", ['name' => 'Jane Doe', 'email' => $jane])['data'];
		self::assertSame($claimed['data']['id'], $invited['id']);
		self::assertNotSame($claimed['data']['key'], $invited['key']);
		self::assertSame('unnamed', $me($final['token'], $claimed['data']['key']), 'the key from naming oneself does not open the link Jane was invited to');
		self::assertSame('reviewer', $me($final['token'], $invited['key']));
		self::assertSame('unnamed', $me($this->token, $invited['key']), 'nor the other way round');
		self::assertSame('reviewer', $me($this->token, $claimed['data']['key']), 'each key opens its own link');

		$links = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['reviewers'][0]['links'];
		self::assertCount(2, array_unique(array_map(static fn (array $each) => substr($each['url'], strpos($each['url'], '?r=')), $links)), 'two Personal Links, two keys');
	}

	public function testAReviewerIsPutOnAndTakenOffSingleLinks(): void {
		$noa = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Noa'])['data'];
		$other = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];

		// Without an address, a Reviewer is put on another link by hand (story 55)
		$put = $this->nc->ocs('POST', "/reviewers/{$noa['id']}/links", ['token' => $other['token']]);
		self::assertSame(201, $put['status'], json_encode($put['data']));
		self::assertStringContainsString("/s/{$other['token']}?r=", $put['data']['link']);
		$key = substr($put['data']['link'], strpos($put['data']['link'], '?r=') + 3);
		self::assertSame('reviewer', $this->reviewer()->through($other['token'])->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['me']['type']);

		// Taken off the first link, they stay the Project's, on the other
		self::assertSame(200, $this->nc->ocs('DELETE', "/reviewers/{$noa['id']}/links/{$this->token}")['status']);
		self::assertSame('unnamed', $this->reviewer()->call('GET', "/api/context?versionId={$this->versionId}&r={$noa['key']}")['data']['me']['type']);
		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data'];
		self::assertSame([[], [$noa['id']]], array_column($listed['links'], 'reviewerIds'));

		// With every link deleted, they are still listed, and can be put on a new one
		$this->nc->ocs('DELETE', "/links/{$other['id']}");
		$this->nc->ocs('DELETE', "/links/{$this->linkId}");
		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data'];
		self::assertSame([['Noa', []]], array_map(static fn (array $each) => [$each['name'], $each['links']], $listed['reviewers']), 'a Reviewer of the Project without a link');
	}

	public function testAReviewerOnNoLinkKeepsTheirName(): void {
		$leon = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Leon'])['data'];
		$this->nc->ocs('DELETE', "/reviewers/{$leon['id']}/links/{$this->token}");
		$other = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];

		self::assertSame(409, $this->nc->ocs('POST', "/links/{$other['id']}/reviewers", ['name' => 'leon'])['status'], 'the Project knows a Leon, on a link or not');
		$kim = $this->nc->ocs('POST', "/links/{$other['id']}/reviewers", ['name' => 'Kim'])['data'];
		self::assertSame(409, $this->nc->ocs('PUT', "/reviewers/{$kim['id']}", ['name' => 'Leon'])['status'], 'nor renamed to it');
		self::assertSame(409, $this->nc->ocs('PUT', "/reviewers/{$leon['id']}", ['name' => 'Kim'])['status'], 'nor is one on no link renamed to a name taken');

		// On no link, no review sees the name; back on one, a Member's name does not come along
		$member = $this->nc->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['displayname'];
		self::assertSame(200, $this->nc->ocs('PUT', "/reviewers/{$leon['id']}", ['name' => $member])['status']);
		self::assertSame(409, $this->nc->ocs('POST', "/reviewers/{$leon['id']}/links", ['token' => $this->token])['status']);
	}

	public function testOnSeveralLinksOnlyTheMemberChangesWhoAReviewerIs(): void {
		$run = bin2hex(random_bytes(4));
		$jane = "jane-$run@example.test";
		$asJane = $this->reviewer();
		$claimed = $asJane->call('POST', '/api/reviewer', ['name' => 'Jane Doe', 'email' => $jane]);
		self::assertSame(201, $claimed['status'], json_encode($claimed['data']));
		self::assertSame(200, $asJane->call('PUT', '/api/reviewer', ['email' => "jane.doe-$run@example.test"])['status'], 'on one link, they change it themselves');
		$asJane->call('PUT', '/api/reviewer', ['email' => $jane]);

		// Invited on a second link, what they are is the Member's to change: mails carry the keys of both
		$final = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$this->nc->ocs('POST', "/links/{$final['id']}/reviewers", ['name' => 'Jane Doe', 'email' => $jane]);
		$context = $asJane->call('GET', "/api/context?versionId={$this->versionId}")['data']['me'];
		self::assertTrue($context['severalLinks']);
		$moved = $asJane->call('PUT', '/api/reviewer', ['email' => "someone-else-$run@example.test"]);
		self::assertSame([409, 'identityLocked'], [$moved['status'], $moved['data']['reason']]);
		self::assertSame(409, $asJane->call('PUT', '/api/reviewer', ['name' => 'Not Jane'])['status']);
		self::assertSame(200, $asJane->call('PUT', '/api/reviewer', ['email' => $jane, 'mailVersions' => true])['status'], 'what is mailed stays theirs');
		self::assertSame(200, $this->nc->ocs('PUT', "/reviewers/{$claimed['data']['id']}", ['name' => 'Jane Doe', 'email' => "jane.doe-$run@example.test"])['status'], 'the Member changes it');
	}

	public function testInvitingAgainOnTheSameLinkHandsOutANewKey(): void {
		$run = bin2hex(random_bytes(4));
		$jane = "jane-$run@example.test";
		$claimed = $this->reviewer()->call('POST', '/api/reviewer', ['name' => 'Jane Doe', 'email' => $jane]);
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Jane Doe', 'email' => $jane])['data'];
		self::assertSame($claimed['data']['id'], $invited['id']);
		self::assertNotSame($claimed['data']['key'], $invited['key']);
		$me = fn (string $key) => $this->reviewer()->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['me']['type'];
		self::assertSame(['unnamed', 'reviewer'], [$me($claimed['data']['key']), $me($invited['key'])], 'whoever named themselves with the address before keeps none of it');
	}

	public function testPuttingOnAndRightsAreChecked(): void {
		$kim = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim'])['data'];
		$rights = fn (mixed $given) => $this->nc->ocs('PUT', "/reviewers/{$kim['id']}/rights", ['token' => $this->token, 'rights' => $given])['status'];
		self::assertSame([400, 400, 200], [$rights('no'), $rights(['canComment' => 'maybe']), $rights(['canComment' => 'false'])]);
		self::assertFalse($this->nc->ocs('GET', "/links/{$this->linkId}/reviewers")['data'][0]['rights']['canComment'], '"false" is no');

		$other = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($other);
		$this->nc->put("$other/promo.mp4", 'not really a video');
		$otherId = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($other)])['data']['id'];
		try {
			$elsewhere = $this->nc->ocs('POST', "/projects/$otherId/links")['data'];
			self::assertSame(404, $this->nc->ocs('POST', "/reviewers/{$kim['id']}/links", ['token' => $elsewhere['token']])['status'], 'never on a link of another Project');
		} finally {
			$this->nc->deleteProject($otherId);
			$this->nc->delete($other);
		}
	}

	public function testANameIsTakenAcrossTheMembersOfAProject(): void {
		$uid = 'deliver-colleague-' . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		try {
			$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $uid, 'permissions' => 31]);
			self::assertSame(200, $this->nc->ocs('PUT', "/projects/{$this->projectId}/members", ['type' => 'user', 'principal' => $uid, 'level' => 'manage', 'share' => true])['status']);
			$theirs = $this->nc->withUser($uid, $password)->ocs('POST', "/projects/{$this->projectId}/links")['data']['token'];
			self::assertSame(201, $this->reviewer()->call('POST', '/api/reviewer', ['name' => 'Mara'])['status']);
			$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $theirs);
			self::assertSame(409, $visitor->call('POST', '/api/reviewer', ['name' => $uid])['status'], 'not the name of a Member the files are shared with');
			$colleague = $this->nc->withUser($uid, $password);
			$theirId = array_values(array_filter($colleague->ocs('GET', "/projects/{$this->projectId}/links")['data']['links'], static fn (array $each) => $each['token'] === $theirs))[0]['id'];
			self::assertSame(409, $colleague->ocs('POST', "/links/$theirId/reviewers", ['name' => 'Mara'])['status'], 'nor invited under a Reviewer\'s name, whichever Member shared the link');
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

		$claimed = $asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara', 'email' => 'mara-' . bin2hex(random_bytes(4)) . '@example.test']);
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

	public function testAReviewerEditsTheirCommentOnlyWhereTheLinkTakesComments(): void {
		$asReviewer = $this->reviewer();
		$asReviewer->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$edited = $this->comment($asReviewer, ['inFrame' => 10, 'body' => 'first']);
		$deleted = $this->comment($asReviewer, ['inFrame' => 20, 'body' => 'second']);
		self::assertSame(200, $asReviewer->call('PUT', "/api/comments/{$edited['id']}", ['body' => 'first, better'])['status']);

		$this->setFlags(['canComment' => false]);
		$read = $asReviewer->call('GET', "/api/versions/{$this->versionId}/comments")['data'];
		self::assertSame([false, true], [$read['canEditOwn'], $read['canDeleteOwn']], 'the client offers Delete only');
		self::assertSame(403, $asReviewer->call('PUT', "/api/comments/{$edited['id']}", ['body' => 'rewritten'])['status']);
		self::assertSame(200, $asReviewer->call('DELETE', "/api/comments/{$deleted['id']}")['status']);
	}

	public function testAMemberInvitesAReviewerAndReissuesTheLinkLater(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Jo', 'email' => 'jo@example.test']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		self::assertStringEndsWith("/s/{$this->token}?r={$invited['data']['key']}", $invited['data']['link'], 'the link URL plus the key');

		$asJo = $this->reviewer();
		$context = $asJo->call('GET', "/api/context?versionId={$this->versionId}&r={$invited['data']['key']}");
		self::assertSame(['reviewer', 'Jo'], [$context['data']['me']['type'], $context['data']['me']['name']], 'identified from the first click');

		// The link is replaced; inviting Jo's address there gives Jo, the same Reviewer, a Personal Link through it (ADR 0014)
		$replacement = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $replacement['status']);
		self::assertSame([], $this->nc->ocs('GET', "/links/{$replacement['data']['id']}/reviewers")['data'], 'nobody is on the new link yet');
		$reissued = $this->nc->ocs('POST', "/links/{$replacement['data']['id']}/reviewers", ['name' => 'Jo', 'email' => 'jo@example.test'])['data'];
		self::assertSame($invited['data']['id'], $reissued['id']);
		self::assertStringEndsWith("/s/{$replacement['data']['token']}?r={$reissued['key']}", $reissued['link']);
		self::assertSame('reviewer', $asJo->through($replacement['data']['token'])->call('GET', "/api/context?versionId={$this->versionId}&r={$reissued['key']}")['data']['me']['type']);
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
		$old = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $this->token);
		self::assertSame('unnamed', $old->call('GET', "/api/context?versionId={$this->versionId}&r=" . $invited['data']['key'])['data']['me']['type'], 'the old Personal Link names nobody any more');
		$fresh = $this->nc->ocs('GET', "/links/{$this->linkId}/reviewers")['data'][0]['link'];
		self::assertNotSame($invited['data']['link'], $fresh);
		self::assertSame('reviewer', $old->call('GET', "/api/context?versionId={$this->versionId}&r=" . substr($fresh, strpos($fresh, '?r=') + 3))['data']['me']['type'], 'the new one does');
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

	public function testAReviewersOwnRightsGoOverThoseOfEachLinkTheyComeBy(): void {
		$invited = $this->nc->ocs('POST', "/links/{$this->linkId}/reviewers", ['name' => 'Kim', 'email' => 'kim@example.test']);
		['id' => $kim, 'key' => $key] = $invited['data'];
		$other = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$onOther = $this->nc->ocs('POST', "/links/{$other['id']}/reviewers", ['name' => 'Kim', 'email' => 'kim@example.test'])['data'];
		self::assertSame($kim, $onOther['id']);
		$unused = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];

		$asKim = $this->reviewer();
		$post = fn (PublicClient $through) => $through->call('POST', "/api/versions/{$this->versionId}/comments?r=$key", ['inFrame' => 1, 'body' => 'hi'])['status'];
		$rights = fn (string $token, array $rights) => $this->nc->ocs('PUT', "/reviewers/$kim/rights", ['token' => $token, 'rights' => $rights]);

		self::assertSame(201, $post($asKim), 'the link lets Reviewers comment');
		$set = $rights($this->token, ['canComment' => false]);
		self::assertSame([200, ['canComment' => false, 'allowOlder' => null, 'watermark' => null]], [$set['status'], $set['data']]);
		self::assertSame(403, $post($asKim), 'Kim may not on this link, whatever it says');
		self::assertFalse($asKim->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['flags']['canComment']);
		self::assertSame(201, $asKim->through($other['token'])->call('POST', "/api/versions/{$this->versionId}/comments?r={$onOther['key']}", ['inFrame' => 1, 'body' => 'hi'])['status'], 'but on their other link, that link decides');

		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['reviewers'][0]['links'];
		self::assertSame(
			[$this->token => ['canComment' => false, 'allowOlder' => null, 'watermark' => null], $other['token'] => ['canComment' => null, 'allowOlder' => null, 'watermark' => null]],
			array_column($listed, 'rights', 'token'),
			'rights of their own on each of their links; a link they are not on is none of theirs',
		);
		self::assertSame(404, $rights($unused['token'], ['canComment' => true])['status'], 'nor can any be set there');

		$this->setFlags(['canComment' => false]);
		$rights($this->token, ['canComment' => true, 'watermark' => true]);
		self::assertSame(201, $post($asKim), 'Kim may, though the link does not let anyone else');
		self::assertTrue($asKim->call('GET', "/api/context?versionId={$this->versionId}&r=$key")['data']['flags']['watermark']);

		$rights($this->token, []);
		self::assertSame(403, $post($asKim), 'without rights of their own, the link decides again');
	}
}
