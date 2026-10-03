<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Projects are collections and access follows the file (ADR 0009): a file
 * shared on its own brings its review along, a Share Link shows Assets of
 * any Project, and Reviewers belong to the Member who invited them.
 */
class CollectionsTest extends TestCase {
	private NextcloudClient $admin;
	private NextcloudClient $owner;
	private NextcloudClient $guest;
	private string $ownerId;
	private string $guestId;
	/** @var list<int> */
	private array $shareIds = [];

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		[$this->ownerId, $this->owner] = $this->user('owner');
		[$this->guestId, $this->guest] = $this->user('guest');
		$this->owner->mkdir('clients');
		$this->owner->mkdir('clients/acme');
		$this->owner->put('clients/acme/cut.mp4', 'not really a video');
		$this->owner->put('clients/acme/teaser.mp4', 'not really a video');
		$this->owner->mkdir('sound');
		$this->owner->put('sound/mix.wav', 'not really audio');
	}

	protected function tearDown(): void {
		foreach ($this->shareIds as $id) {
			$this->owner->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/$id");
		}
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->ownerId}");
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->guestId}");
	}

	/** @return array{0: string, 1: NextcloudClient} */
	private function user(string $role): array {
		$uid = "deliver-$role-" . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		return [$uid, $this->admin->withUser($uid, $password)];
	}

	private function enable(string $path, int $projectId): array {
		$enabled = $this->owner->ocs('POST', '/assets', ['fileId' => $this->owner->fileId($path), 'projectId' => $projectId]);
		self::assertSame(201, $enabled['status'], json_encode($enabled['data']));
		return $enabled['data'];
	}

	private function shareWithGuest(string $path, int $permissions): void {
		$shared = $this->owner->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/$path", 'shareType' => 0, 'shareWith' => $this->guestId, 'permissions' => $permissions,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
		$this->shareIds[] = (int)$shared['data']['id'];
	}

	public function testAFileSharedOnItsOwnBringsItsReviewAlong(): void {
		$project = $this->owner->ocs('POST', '/projects', ['name' => 'Acme spot'])['data']['id'];
		$cut = $this->enable('clients/acme/cut.mp4', $project);
		$this->enable('clients/acme/teaser.mp4', $project);
		$this->enable('sound/mix.wav', $project);
		self::assertSame(201, $this->owner->ocs('POST', "/versions/{$cut['versionId']}/comments", ['inFrame' => 3, 'body' => 'logo late'])['status']);

		// The guest can open one file of the Project, read-only
		$this->shareWithGuest('clients/acme/cut.mp4', 1);
		$listed = array_column($this->guest->ocs('GET', '/projects')['data'], null, 'id');
		self::assertArrayHasKey($project, $listed, 'a Project shows up for whoever can open one of its files');
		self::assertSame(1, $listed[$project]['activity']['assets']);
		self::assertFalse($listed[$project]['canWrite'], 'only who made it changes it');
		$shown = $this->guest->ocs('GET', "/projects/$project")['data'];
		self::assertSame(['cut'], array_column($shown['assets'], 'name'), 'and only the Assets they can open');
		self::assertFalse($shown['assets'][0]['canWrite']);

		$comments = $this->guest->ocs('GET', "/versions/{$cut['versionId']}/comments");
		self::assertSame([200, 'logo late'], [$comments['status'], $comments['data']['comments'][0]['body']]);
		self::assertSame(201, $this->guest->ocs('POST', "/versions/{$cut['versionId']}/comments", ['inFrame' => 5, 'body' => 'agreed'])['status'], 'read access comments');
		self::assertSame(403, $this->guest->ocs('PUT', "/comments/{$comments['data']['comments'][0]['id']}/resolved", ['resolved' => true])['status'], 'but does not resolve');
		self::assertSame(403, $this->guest->ocs('PUT', "/projects/$project", ['name' => 'Mine now'])['status']);
		self::assertSame(403, $this->guest->ocs('PUT', "/assets/{$cut['assetId']}/project", ['projectId' => 0])['status'], 'nor assigns');
		self::assertEqualsCanonicalizing([$this->ownerId, $this->guestId], array_column($this->owner->ocs('GET', "/versions/{$cut['versionId']}/members")['data'], 'id'), 'whoever can open the file can be mentioned');

		$mix = $this->owner->ocs('GET', '/files/' . $this->owner->fileId('sound/mix.wav') . '/asset')['data'];
		self::assertSame(404, $this->guest->ocs('GET', "/versions/{$mix['versionId']}/comments")['status'], 'a file they cannot open stays closed');
		self::assertSame([], $this->guest->ocs('GET', '/projects/0')['data']['assets'], 'No Project lists only what the guest enabled');
	}

	public function testAShareLinkShowsAssetsOfAnyProject(): void {
		$project = $this->owner->ocs('POST', '/projects', ['name' => 'Acme spot'])['data']['id'];
		$this->enable('clients/acme/cut.mp4', $project);
		$this->enable('clients/acme/teaser.mp4', 0);

		$link = $this->owner->ocs('POST', '/files/' . $this->owner->fileId('clients') . '/shares');
		self::assertSame(201, $link['status'], json_encode($link['data']));
		$this->shareIds[] = $link['data']['id'];
		$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['data']['token']);
		$assets = $visitor->call('GET', '/api/assets');
		self::assertSame(200, $assets['status'], json_encode($assets['data']));
		self::assertCount(2, $assets['data'], 'one in a Project, one in No Project, both under the link');

		// The Project's navigation lists links on its own files, not a folder that merely holds one of them
		$fileLink = $this->owner->ocs('POST', '/files/' . $this->owner->fileId('clients/acme/cut.mp4') . '/shares')['data'];
		$this->shareIds[] = $fileLink['id'];
		$links = $this->owner->ocs('GET', "/projects/$project/shares")['data']['links'];
		self::assertSame([$fileLink['id']], array_column($links, 'id'));
		self::assertFalse($links[0]['isProject'], 'the Project has no folder of its own');
	}

	public function testReviewersBelongToTheMemberWhoInvitedThem(): void {
		$first = $this->owner->ocs('POST', '/projects', ['name' => 'Acme spot'])['data']['id'];
		$this->enable('clients/acme/cut.mp4', $first);
		$this->enable('sound/mix.wav', 0);
		$cutLink = $this->owner->ocs('POST', '/files/' . $this->owner->fileId('clients/acme/cut.mp4') . '/shares')['data'];
		$mixLink = $this->owner->ocs('POST', '/files/' . $this->owner->fileId('sound/mix.wav') . '/shares')['data'];
		array_push($this->shareIds, $cutLink['id'], $mixLink['id']);

		$invited = $this->owner->ocs('POST', "/shares/{$cutLink['id']}/reviewers", ['name' => 'Kim']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		$onMix = array_column($this->owner->ocs('GET', "/shares/{$mixLink['id']}/reviewers")['data'], 'link', 'name');
		self::assertStringContainsString("/s/{$mixLink['token']}?r=", $onMix['Kim'], 'Kim has a Personal Link through every link of the Member, whatever the Project');

		$asKim = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $mixLink['token']);
		$mixVersion = $asKim->call('GET', '/api/assets')['data'][0]['versionId'];
		$context = $asKim->call('GET', "/api/context?versionId=$mixVersion&r={$invited['data']['key']}");
		self::assertSame(['reviewer', 'Kim'], [$context['data']['me']['type'], $context['data']['me']['name']]);

		// Another Member's link does not know Kim
		$this->owner->put('sound/other.wav', 'not really audio');
		$this->shareWithGuest('sound', 31);
		$guestFile = $this->guest->fileId('sound/other.wav');
		self::assertSame(201, $this->guest->ocs('POST', '/assets', ['fileId' => $guestFile])['status']);
		$guestLink = $this->guest->ocs('POST', "/files/$guestFile/shares")['data'];
		$asStranger = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $guestLink['token']);
		$otherVersion = $asStranger->call('GET', '/api/assets')['data'][0]['versionId'];
		$context = $asStranger->call('GET', "/api/context?versionId=$otherVersion&r={$invited['data']['key']}");
		self::assertSame('unnamed', $context['data']['me']['type']);
		$this->guest->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$guestLink['id']}");
	}
}
