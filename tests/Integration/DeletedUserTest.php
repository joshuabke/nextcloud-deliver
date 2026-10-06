<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * A deleted account leaves nothing to whoever is created under its user id
 * next: its Projects, links and Reviewers go or pass on, and its Comments and
 * Approvals stay, by a Deleted user.
 */
class DeletedUserTest extends TestCase {
	private NextcloudClient $admin;
	private NextcloudClient $keeper;
	private string $keeperId;
	private string $goneId;

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->keeperId = 'deliver-keeper-' . bin2hex(random_bytes(4));
		$this->keeper = $this->user($this->keeperId);
		$this->goneId = 'deliver-gone-' . bin2hex(random_bytes(4));
	}

	protected function tearDown(): void {
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->keeperId}");
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->goneId}");
	}

	private function user(string $uid): NextcloudClient {
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$made = $this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		self::assertSame(200, $made['status'], json_encode($made['data']));
		return $this->admin->withUser($uid, $password);
	}

	private function shareSharedWith(string $uid): void {
		$shared = $this->keeper->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => '/shared', 'shareType' => 0, 'shareWith' => $uid, 'permissions' => 31,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
	}

	public function testANewAccountUnderTheSameUserIdInheritsNothing(): void {
		$this->keeper->mkdir('shared');
		$this->keeper->put('shared/cut.mp4', 'not really a video');
		$gone = $this->user($this->goneId);
		$this->shareSharedWith($this->goneId);
		$gone->put('own.mp4', 'not really a video');

		// A Folder Project on the keeper's folder, and a Project of their own, both made by the account that goes
		$folderProject = $gone->ocs('POST', '/projects', ['folderId' => $gone->fileId('shared')]);
		self::assertSame(201, $folderProject['status'], json_encode($folderProject['data']));
		$folderProject = $folderProject['data']['id'];
		$named = $gone->ocs('POST', '/projects', ['name' => 'Mine'])['data']['id'];
		self::assertSame(201, $gone->ocs('POST', '/assets', ['fileId' => $gone->fileId('own.mp4'), 'projectId' => $named])['status']);
		$cut = $gone->ocs('GET', '/files/' . $gone->fileId('shared/cut.mp4') . '/asset')['data'];
		$comment = $gone->ocs('POST', "/versions/{$cut['versionId']}/comments", ['inFrame' => 3, 'body' => 'logo late'])['data'];
		$gone->ocs('PUT', "/comments/{$comment['id']}/reactions", ['emoji' => '👍']);
		$gone->ocs('PUT', "/versions/{$cut['versionId']}/approval", ['status' => 'approved']);
		$link = $gone->ocs('POST', "/projects/$folderProject/links")['data'];
		$reviewer = $gone->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Kim', 'email' => 'kim@example.test'])['data'];

		self::assertSame(200, $this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->goneId}")['status']);
		$again = $this->user($this->goneId);

		self::assertSame([], $again->ocs('GET', '/projects')['data'], 'no Project of the old account, not even No Project');
		self::assertSame(404, $again->ocs('GET', "/projects/$named")['status']);
		self::assertSame(404, $again->ocs('GET', "/links/{$link['id']}/reviewers")['status']);
		self::assertNotSame(200, $again->ocs('POST', "/reviewers/{$reviewer['id']}/key")['status'], 'nor its Reviewers');
		$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		self::assertSame(404, $visitor->raw('')['status'], 'its links stop working');

		// The Folder Project passes to whoever owns the folder
		$kept = $this->keeper->ocs('GET', "/projects/$folderProject");
		self::assertSame(200, $kept['status']);
		self::assertTrue($kept['data']['canWrite']);
		self::assertSame([], $this->keeper->ocs('GET', "/projects/$folderProject/links")['data']['links']);

		// Comments and Approvals stay, by a Deleted user the new account is not
		$this->shareSharedWith($this->goneId);
		$listed = $again->ocs('GET', "/versions/{$cut['versionId']}/comments")['data'];
		self::assertSame('logo late', $listed['comments'][0]['body']);
		self::assertSame('deleted', $listed['comments'][0]['author']['type']);
		self::assertSame('deleted', $listed['comments'][0]['reactions'][0]['authors'][0]['type']);
		self::assertSame('deleted', $listed['approvals'][0]['author']['type']);
		self::assertSame(403, $again->ocs('PUT', "/comments/{$comment['id']}", ['body' => 'mine now'])['status']);
	}
}
