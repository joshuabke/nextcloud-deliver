<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Review Links and Reviewers belong to the Project (ADR 0017): every Member
 * who sees it lists and manages all of them, an address is one Reviewer per
 * Project whoever invites it, and No Project stays each Member's own.
 */
class ProjectLinksTest extends TestCase {
	private NextcloudClient $anna;
	private NextcloudClient $ben;
	private NextcloudClient $stranger;
	private string $annaId;
	private string $benId;
	private string $strangerId;
	private string $root;
	private int $projectId;
	private int $versionId;
	/** @var list<string> */
	private array $cleanup = [];

	protected function setUp(): void {
		$admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->anna = $admin;
		$this->annaId = $admin->user;
		[$this->benId, $this->ben] = $this->user($admin);
		[$this->strangerId, $this->stranger] = $this->user($admin);

		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$admin->mkdir($this->root);
		$admin->put("{$this->root}/cut.mp4", 'not really a video');
		$created = $admin->ocs('POST', '/projects', ['folderId' => $admin->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->versionId = $admin->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
		$shared = $admin->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}", 'shareType' => 0, 'shareWith' => $this->benId, 'permissions' => 31]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
		// Writing and resharing in Files is not Share in Deliver: the owner gives it (ADR 0016)
		$given = $admin->ocs('PUT', "/projects/{$this->projectId}/members", ['type' => 'user', 'principal' => $this->benId, 'level' => 'manage', 'share' => true]);
		self::assertSame(200, $given['status'], json_encode($given['data']));
	}

	protected function tearDown(): void {
		$this->anna->deleteProject($this->projectId);
		$this->anna->delete($this->root);
		foreach ($this->cleanup as $path) {
			$this->anna->delete($path);
		}
		foreach ([$this->benId, $this->strangerId] as $uid) {
			$this->anna->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$uid");
		}
	}

	/** @return array{string, NextcloudClient} */
	private function user(NextcloudClient $admin): array {
		$uid = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$made = $admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		self::assertSame(200, $made['status'], json_encode($made['data']));
		return [$uid, $admin->withUser($uid, $password)];
	}

	/** @return array<string, mixed> */
	private function link(NextcloudClient $as): array {
		$created = $as->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data'];
	}

	/** @return array<string, mixed> the Project's links and Reviewers as this Member lists them */
	private function listed(NextcloudClient $as): array {
		$listed = $as->ocs('GET', "/projects/{$this->projectId}/links");
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		return $listed['data'];
	}

	/** @return array<string, mixed> the invited Reviewer */
	private function invite(NextcloudClient $as, int $linkId, string $name, ?string $email = null): array {
		$invited = $as->ocs('POST', "/links/$linkId/reviewers", ['name' => $name, 'email' => $email]);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		return $invited['data'];
	}

	private function visitor(array $link): PublicClient {
		return new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
	}

	public function testEveryMemberListsAndManagesEveryLinkOfTheProject(): void {
		$annas = $this->link($this->anna);
		$bens = $this->link($this->ben);
		$annasName = $this->anna->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['display-name'];
		$bensName = $this->ben->ocsForm('GET', '/ocs/v2.php/cloud/user')['data']['display-name'];
		self::assertSame(['id' => $this->annaId, 'name' => $annasName], $annas['madeBy']);

		foreach ([$this->anna, $this->ben] as $as) {
			$links = array_column($this->listed($as)['links'], 'madeBy', 'id');
			self::assertSame([$annas['id'] => $annas['madeBy'], $bens['id'] => ['id' => $this->benId, 'name' => $bensName]], $links, 'both see both, each saying who made it');
		}

		$paused = $this->ben->ocs('PUT', "/links/{$annas['id']}", ['review' => false, 'label' => 'Rough cut']);
		self::assertSame([200, false, 'Rough cut'], [$paused['status'], $paused['data']['live'], $paused['data']['label']], json_encode($paused['data']));
		self::assertSame($annas['madeBy'], $paused['data']['madeBy'], 'changing it does not make it theirs');
		self::assertSame(404, $this->visitor($annas)->raw('')['status'], 'a paused link shows nothing');

		$kim = $this->invite($this->ben, $annas['id'], 'Kim', 'kim@example.test');
		self::assertSame(['Kim'], array_column($this->anna->ocs('GET', "/links/{$annas['id']}/reviewers")['data'], 'name'), 'the maker sees who was invited on their link');
		self::assertSame(200, $this->ben->ocs('GET', "/links/{$annas['id']}/activity")['status']);

		$invitation = $this->ben->ocs('POST', "/projects/{$this->projectId}/invitations", ['name' => 'Lee']);
		self::assertSame([201, $this->benId], [$invitation['status'], $invitation['data']['link']['madeBy']['id']], json_encode($invitation['data']));
		self::assertSame(200, $this->anna->ocs('DELETE', "/links/{$invitation['data']['link']['id']}")['status'], 'and Anna deletes the link Ben made');
		self::assertSame(200, $this->ben->ocs('DELETE', "/links/{$annas['id']}")['status']);
		self::assertSame([$bens['id']], array_column($this->listed($this->anna)['links'], 'id'));
		self::assertContains($kim['id'], array_column($this->listed($this->anna)['reviewers'], 'id'), 'the Reviewers outlive their links');
	}

	public function testEveryMemberManagesEveryReviewerOfTheProject(): void {
		$annas = $this->link($this->anna);
		$bens = $this->link($this->ben);
		$kim = $this->invite($this->anna, $annas['id'], 'Kim', 'kim@example.test');

		self::assertSame(['Kim'], array_column($this->listed($this->ben)['reviewers'], 'name'), 'listed for Ben though Anna invited them');
		$edited = $this->ben->ocs('PUT', "/reviewers/{$kim['id']}", ['name' => 'Kim N.', 'email' => 'kim@example.test']);
		self::assertSame([200, 'Kim N.'], [$edited['status'], $edited['data']['name']], json_encode($edited['data']));
		self::assertSame(200, $this->ben->ocs('PUT', "/reviewers/{$kim['id']}/rights", ['token' => $annas['token'], 'rights' => ['canComment' => false]])['status']);
		self::assertFalse($this->anna->ocs('GET', "/links/{$annas['id']}/reviewers")['data'][0]['rights']['canComment'], 'rights per link');

		$put = $this->ben->ocs('POST', "/reviewers/{$kim['id']}/links", ['token' => $bens['token']]);
		self::assertSame(201, $put['status'], json_encode($put['data']));
		self::assertSame(200, $this->anna->ocs('DELETE', "/reviewers/{$kim['id']}/links/{$bens['token']}")['status'], 'and Anna takes them off Ben\'s link');
		self::assertSame(200, $this->ben->ocs('POST', "/reviewers/{$kim['id']}/key")['status']);
		self::assertSame(200, $this->ben->ocs('DELETE', "/reviewers/{$kim['id']}")['status']);
		self::assertSame([], $this->listed($this->anna)['reviewers']);
	}

	public function testAnAddressIsOneReviewerWhoeverInvites(): void {
		$annas = $this->link($this->anna);
		$bens = $this->link($this->ben);
		$kim = $this->invite($this->anna, $annas['id'], 'Kim Green', 'kim@example.test');

		$again = $this->invite($this->ben, $bens['id'], 'Kimmy', 'KIM@example.test');
		self::assertSame([$kim['id'], 'Kim Green'], [$again['id'], $again['name']], 'the same Reviewer, under the name they have');
		self::assertNotSame($kim['key'], $again['key'], 'with a key of their own on the other link');
		$listed = $this->listed($this->ben);
		self::assertSame(['Kim Green'], array_column($listed['reviewers'], 'name'));
		self::assertSame([[$kim['id']], [$kim['id']]], array_column($listed['links'], 'reviewerIds'));

		$invitation = $this->ben->ocs('POST', "/projects/{$this->projectId}/invitations", ['name' => 'Someone', 'email' => 'kim@example.test']);
		self::assertSame($kim['id'], $invitation['data']['reviewer']['id'], 'an invitation on a link of its own too');

		self::assertSame(409, $this->ben->ocs('POST', "/links/{$bens['id']}/reviewers", ['name' => 'kim green', 'email' => 'other@example.test'])['status'], 'a name is taken across the Project, whoever invited');
		$lee = $this->invite($this->ben, $bens['id'], 'Lee', 'lee@example.test');
		self::assertSame(409, $this->anna->ocs('PUT', "/reviewers/{$lee['id']}", ['name' => 'Lee', 'email' => 'KIM@example.test'])['status'], 'nor does any Member give a Reviewer an address another has');
		self::assertSame(200, $this->anna->ocs('PUT', "/reviewers/{$lee['id']}", ['name' => 'Lee', 'email' => 'lee@example.test'])['status']);

		$named = $this->visitor($bens)->call('POST', '/api/reviewer', ['name' => 'K.', 'email' => 'kim@example.test']);
		self::assertSame(202, $named['status'], 'naming oneself with it on any link leads back to the one Reviewer');
	}

	public function testSomeoneWhoDoesNotSeeTheProjectGetsNothing(): void {
		$link = $this->link($this->anna);
		$kim = $this->invite($this->anna, $link['id'], 'Kim');
		$as = $this->stranger;

		self::assertSame(404, $as->ocs('GET', "/projects/{$this->projectId}/links")['status']);
		self::assertSame(404, $as->ocs('POST', "/projects/{$this->projectId}/links")['status']);
		self::assertSame(404, $as->ocs('PUT', "/links/{$link['id']}", ['review' => false])['status']);
		self::assertSame(404, $as->ocs('DELETE', "/links/{$link['id']}")['status']);
		self::assertSame(404, $as->ocs('GET', "/links/{$link['id']}/reviewers")['status']);
		self::assertSame(404, $as->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Mo'])['status']);
		self::assertSame(404, $as->ocs('GET', "/links/{$link['id']}/activity")['status']);
		self::assertSame(404, $as->ocs('POST', "/projects/{$this->projectId}/invitations", ['name' => 'Mo'])['status']);
		self::assertSame(404, $as->ocs('PUT', "/reviewers/{$kim['id']}", ['name' => 'Kimmy'])['status']);
		self::assertSame(404, $as->ocs('PUT', "/reviewers/{$kim['id']}/rights", ['token' => $link['token'], 'rights' => ['canComment' => false]])['status']);
		self::assertSame(404, $as->ocs('POST', "/reviewers/{$kim['id']}/key")['status']);
		self::assertSame(404, $as->ocs('DELETE', "/reviewers/{$kim['id']}")['status']);
		self::assertSame(['Kim'], array_column($this->listed($this->anna)['reviewers'], 'name'), 'and nothing changed');
	}

	public function testNoProjectStaysEachMembersOwn(): void {
		$file = "{$this->root}-solo.mp4";
		$this->anna->put($file, 'not really a video');
		$this->cleanup[] = $file;
		$asset = $this->anna->ocs('POST', '/assets', ['fileId' => $this->anna->fileId($file)]);
		self::assertSame(201, $asset['status'], json_encode($asset['data']));
		$link = $this->anna->ocs('POST', '/projects/0/links', ['assetIds' => [$asset['data']['assetId']]])['data'];
		$kim = $this->invite($this->anna, $link['id'], 'Kim', 'kim@example.test');

		self::assertSame([], $this->ben->ocs('GET', '/projects/0/links')['data']['links'], 'Ben\'s No Project has none of Anna\'s links');
		self::assertSame([], $this->ben->ocs('GET', '/projects/0/links')['data']['reviewers']);
		self::assertSame(403, $this->ben->ocs('PUT', "/links/{$link['id']}", ['review' => false])['status']);
		self::assertSame(403, $this->ben->ocs('DELETE', "/links/{$link['id']}")['status']);
		self::assertSame(403, $this->ben->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Mo'])['status']);
		self::assertSame(403, $this->ben->ocs('PUT', "/reviewers/{$kim['id']}", ['name' => 'Kimmy'])['status']);
		self::assertSame(403, $this->ben->ocs('DELETE', "/reviewers/{$kim['id']}")['status']);
		self::assertSame(['Kim'], array_column($this->anna->ocs('GET', '/projects/0/links')['data']['reviewers'], 'name'));
		self::assertSame($this->annaId, $this->anna->ocs('GET', '/projects/0/links')['data']['links'][0]['madeBy']['id']);

		// An address is one Reviewer per Member there, not per Project
		$benFile = "{$this->root}-solo-ben.mp4";
		$this->ben->put($benFile, 'not really a video');
		$benAsset = $this->ben->ocs('POST', '/assets', ['fileId' => $this->ben->fileId($benFile)])['data']['assetId'];
		$bens = $this->ben->ocs('POST', '/projects/0/links', ['assetIds' => [$benAsset]])['data'];
		$theirKim = $this->invite($this->ben, $bens['id'], 'Kim', 'kim@example.test');
		self::assertNotSame($kim['id'], $theirKim['id'], 'Ben\'s Kim is another Reviewer');
	}

	public function testContactsAreCheckedAgainstTheMemberWhoLooks(): void {
		$annas = $this->link($this->anna);
		$this->invite($this->anna, $annas['id'], 'Kim', 'kim@example.test');
		$card = 'kim-' . bin2hex(random_bytes(4));
		$put = $this->anna->request('PUT', "/remote.php/dav/addressbooks/users/{$this->annaId}/contacts/$card.vcf", "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:$card\r\nFN:Kim Green\r\nEMAIL;TYPE=WORK:kim@example.test\r\nEND:VCARD\r\n", ['Content-Type: text/vcard']);
		self::assertSame(201, $put['status'], $put['body']);
		try {
			self::assertTrue($this->listed($this->anna)['reviewers'][0]['inContacts']);
			self::assertFalse($this->listed($this->ben)['reviewers'][0]['inContacts'], 'in Anna\'s contacts is not in Ben\'s');
		} finally {
			$this->anna->request('DELETE', "/remote.php/dav/addressbooks/users/{$this->annaId}/contacts/$card.vcf");
		}
	}

	/** Runs PHP inside this Nextcloud and returns what it printed */
	private function inNextcloud(string $code): string {
		exec('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; \\OCP\\Server::get(\\OCP\\App\\IAppManager::class)->loadApp("deliver"); ' . $code) . ' 2>&1', $output, $status);
		self::assertSame(0, $status, implode("\n", $output));
		return implode("\n", $output);
	}

	/** @return list<array<string, mixed>> */
	private function rows(string $sql): array {
		return json_decode($this->inNextcloud('echo json_encode(\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeQuery(' . var_export($sql, true) . ')->fetchAll());'), true, flags: JSON_THROW_ON_ERROR);
	}

	private function sql(string $sql): void {
		$this->inNextcloud('\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeStatement(' . var_export($sql, true) . ');');
	}

	public function testReviewersWhoShareAnAddressAreMergedIntoTheOldest(): void {
		$first = $this->link($this->anna);
		$second = $this->link($this->ben);
		$kim = $this->invite($this->anna, $first['id'], 'Kim Green', 'kim@example.test');
		$lee = $this->invite($this->anna, $first['id'], 'Lee', 'lee@example.test');
		$comment = $this->anna->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'from the Member'])['data'];

		// Two more Reviewers of the address, made by hand as ADR 0013's per-Member rule left them
		$project = $this->projectId;
		$this->sql("INSERT INTO *PREFIX*deliver_reviewers (owner_uid, project_id, name, email, created_at) VALUES ('{$this->benId}', $project, 'Kimmy', 'KIM@example.test', 2000000000)");
		$this->sql("INSERT INTO *PREFIX*deliver_reviewers (owner_uid, project_id, name, email, created_at) VALUES ('{$this->benId}', $project, 'Kim again', 'Kim@Example.test', 2000000001)");
		$extra = $this->rows("SELECT id FROM *PREFIX*deliver_reviewers WHERE project_id = $project AND name IN ('Kimmy', 'Kim again') ORDER BY id");
		[$kimmy, $again] = array_map(static fn (array $row) => (int)$row['id'], $extra);
		self::assertSame(3, count(array_filter($this->rows("SELECT id, email FROM *PREFIX*deliver_reviewers WHERE project_id = $project"), static fn (array $row) => strtolower((string)$row['email']) === 'kim@example.test')), 'the duplicates stand before the merge');

		// Where each of them is: Kimmy on both links, one of them Kim's too; Kim again on the second
		$at = 1700000000;
		$this->sql("INSERT INTO *PREFIX*deliver_reviewer_links (reviewer_id, token, secret_key, created_at) VALUES ($kimmy, '{$first['token']}', 'kimmy-first', $at), ($kimmy, '{$second['token']}', 'kimmy-second', $at), ($again, '{$second['token']}', 'again-second', $at)");
		// Comments, Approvals (the newer decision wins), Reactions (no duplicates), Unseen (the later), activity
		$k = $kim['id'];
		$v = $this->versionId;
		$c = $comment['id'];
		$this->sql("INSERT INTO *PREFIX*deliver_comments (version_id, reviewer_id, in_frame, body, resolved, created_at, updated_at) VALUES ($v, $kimmy, 2, 'by Kimmy', false, $at, $at), ($v, $again, 3, 'by Kim again', false, $at, $at)");
		$this->sql("INSERT INTO *PREFIX*deliver_approvals (version_id, reviewer_id, status, updated_at) VALUES ($v, $k, 'approved', 100), ($v, $kimmy, 'changes', 200)");
		$this->sql("INSERT INTO *PREFIX*deliver_reactions (comment_id, reviewer_id, emoji) VALUES ($c, $k, '👍'), ($c, $kimmy, '👍'), ($c, $kimmy, '❤️'), ($c, $again, '👍')");
		$this->sql("INSERT INTO *PREFIX*deliver_seen (version_id, reviewer_id, seen_until) VALUES ($v, $k, 50), ($v, $kimmy, 70)");
		$this->sql("INSERT INTO *PREFIX*deliver_link_activity (token, reviewer_id, kind, version_id, created_at) VALUES ('{$second['token']}', $again, 'viewed', $v, $at)");

		$merged = $this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\Db\\ReviewerMapper::class)->mergeSameAddress();');
		self::assertSame('2', $merged, 'two Reviewers went into the oldest');

		$reviewers = $this->listed($this->anna)['reviewers'];
		self::assertEqualsCanonicalizing(['Kim Green', 'Lee'], array_column($reviewers, 'name'), 'one Reviewer per address, the oldest with its name');
		$kims = array_values(array_filter($reviewers, static fn (array $each) => $each['name'] === 'Kim Green'))[0];
		self::assertSame($kim['id'], $kims['id']);
		self::assertSame([$first['token'], $second['token']], array_column($kims['links'], 'token'), 'on every link any of them was on');
		self::assertSame([$kim['key']], [substr((string)$kims['links'][0]['url'], -32)], 'where both were on a link, the oldest keeps its key');
		self::assertSame('kimmy-second', substr((string)$kims['links'][1]['url'], strpos((string)$kims['links'][1]['url'], '?r=') + 3), 'and the others\' places move to it');
		self::assertSame('unnamed', $this->visitor($first)->call('GET', "/api/context?versionId=$v&r=kimmy-first")['data']['me']['type'], 'the Personal Link of the one that went stops working where both were on it');
		self::assertSame('Kim Green', $this->visitor($second)->call('GET', "/api/context?versionId=$v&r=kimmy-second")['data']['me']['name'], 'and the one that moved works on the link they were on alone');
		self::assertSame('unnamed', $this->visitor($second)->call('GET', "/api/context?versionId=$v&r=again-second")['data']['me']['type'], 'one of two on the same link keeps only the older one\'s Personal Link');

		self::assertSame([$k, $k], array_map(static fn (array $row) => (int)$row['reviewer_id'], $this->rows("SELECT reviewer_id FROM *PREFIX*deliver_comments WHERE reviewer_id IS NOT NULL AND version_id = $v")), 'their Comments');
		self::assertSame([[$k, 'changes']], array_map(static fn (array $row) => [(int)$row['reviewer_id'], $row['status']], $this->rows("SELECT reviewer_id, status FROM *PREFIX*deliver_approvals WHERE version_id = $v AND reviewer_id IS NOT NULL")), 'one Approval, the newest decision');
		self::assertEqualsCanonicalizing([[$k, '❤️'], [$k, '👍']], array_map(static fn (array $row) => [(int)$row['reviewer_id'], $row['emoji']], $this->rows("SELECT reviewer_id, emoji FROM *PREFIX*deliver_reactions WHERE comment_id = $c")), 'each Reaction once');
		self::assertSame([[$k, 70]], array_map(static fn (array $row) => [(int)$row['reviewer_id'], (int)$row['seen_until']], $this->rows("SELECT reviewer_id, seen_until FROM *PREFIX*deliver_seen WHERE version_id = $v AND reviewer_id IS NOT NULL")), 'the later Unseen mark');
		self::assertSame($k, (int)$this->rows("SELECT reviewer_id FROM *PREFIX*deliver_link_activity WHERE token = '{$second['token']}'")[0]['reviewer_id'], 'their activity');
		self::assertSame([], $this->rows("SELECT id FROM *PREFIX*deliver_reviewers WHERE id IN ($kimmy, $again)"), 'the merged rows are gone');
		self::assertSame($lee['id'], $this->rows("SELECT id FROM *PREFIX*deliver_reviewers WHERE name = 'Lee' AND project_id = $project")[0]['id'] + 0, 'others stay');

		self::assertSame('0', $this->inNextcloud('echo \\OCP\\Server::get(\\OCA\\Deliver\\Db\\ReviewerMapper::class)->mergeSameAddress();'), 'and a second run finds nothing');
	}
}
