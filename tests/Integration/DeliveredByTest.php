<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Each Version names the account whose request wrote its file or enabled it
 * for review; the periodic scan names nobody, and a deleted account leaves
 * nobody behind.
 */
class DeliveredByTest extends TestCase {
	private NextcloudClient $admin;
	private NextcloudClient $owner;
	private NextcloudClient $anna;
	private NextcloudClient $ben;
	/** @var list<string> */
	private array $users = [];
	private int $projectId;

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		[$this->owner, $this->anna, $this->ben] = [$this->user('owner'), $this->user('anna'), $this->user('ben')];
		$this->owner->mkdir('shared');
		foreach ([$this->anna, $this->ben] as $member) {
			$shared = $this->owner->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
				'path' => '/shared', 'shareType' => 0, 'shareWith' => $member->user, 'permissions' => 31,
			]);
			self::assertSame(200, $shared['status'], json_encode($shared['data']));
		}
		$created = $this->owner->ocs('POST', '/projects', ['folderId' => $this->owner->fileId('shared')]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
	}

	protected function tearDown(): void {
		foreach ($this->users as $uid) {
			$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$uid");
		}
	}

	private function user(string $name): NextcloudClient {
		$uid = "deliver-$name-" . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$made = $this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password, 'displayName' => ucfirst($name)]);
		self::assertSame(200, $made['status'], json_encode($made['data']));
		$this->users[] = $uid;
		return $this->admin->withUser($uid, $password);
	}

	/** @return array<string, mixed>|null who delivered the newest Version of the named Asset, as the Project view shows it */
	private function deliveredBy(string $asset): ?array {
		$shown = $this->owner->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		foreach ($shown['data']['assets'] as $each) {
			if ($each['name'] === $asset) {
				return $each['versions'][0]['deliveredBy'];
			}
		}
		self::fail("no Asset $asset");
	}

	private function person(NextcloudClient $who, string $name): array {
		return ['type' => 'user', 'id' => $who->user, 'name' => $name];
	}

	public function testAFileUploadedByAMemberIsDeliveredByThem(): void {
		$this->anna->put('shared/uploaded.mp4', 'not really a video');
		self::assertSame($this->person($this->anna, 'Anna'), $this->deliveredBy('uploaded'));

		$asset = $this->owner->ocs('GET', '/files/' . $this->owner->fileId('shared/uploaded.mp4') . '/asset')['data'];
		self::assertSame($this->person($this->anna, 'Anna'), $asset['deliveredBy'], 'the Files sidebar says so too');
		$review = $this->owner->ocs('GET', "/versions/{$asset['versionId']}");
		self::assertSame($this->person($this->anna, 'Anna'), $review['data']['versions'][0]['deliveredBy'], 'and the Review view');
	}

	public function testEnablingAFileDeliversItAndWritingItAgainPassesItOn(): void {
		self::assertSame(200, $this->owner->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => false])['status']);
		$this->anna->put('shared/enabled.mp4', 'not really a video');
		self::assertSame(404, $this->owner->ocs('GET', '/files/' . $this->owner->fileId('shared/enabled.mp4') . '/asset')['status'], 'nobody enabled it yet');

		$enabled = $this->ben->ocs('POST', '/assets', ['fileId' => $this->owner->fileId('shared/enabled.mp4'), 'projectId' => $this->projectId]);
		self::assertSame(201, $enabled['status'], json_encode($enabled['data']));
		self::assertSame($this->person($this->ben, 'Ben'), $this->deliveredBy('enabled'), 'whoever enabled it, not who uploaded it');

		$this->anna->put('shared/enabled.mp4', 'a second take, still not a video');
		self::assertSame($this->person($this->anna, 'Anna'), $this->deliveredBy('enabled'), 'written again in place');
	}

	public function testWhatOnlyTheScanFindsIsDeliveredByNobody(): void {
		self::assertSame(200, $this->owner->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => false])['status']);
		$this->anna->put('shared/found.mp4', 'not really a video');
		// Turning Auto Intake on takes in the files already lying there, no file event involved
		self::assertSame(200, $this->owner->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => true])['status']);
		self::assertNull($this->deliveredBy('found'));
	}

	public function testADeletedAccountDeliveredNothing(): void {
		$this->anna->put('shared/gone.mp4', 'not really a video');
		self::assertNotNull($this->deliveredBy('gone'));
		self::assertSame(200, $this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->anna->user}")['status']);
		self::assertNull($this->deliveredBy('gone'));
	}
}
