<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Runs against the real Nextcloud container over HTTP (see Makefile `test-integration`).
 * A folder becomes a Folder Project and its video and audio files show up as
 * Assets; a Project by name collects files from anywhere, and a file can wait
 * in No Project (ADR 0009).
 */
class ProjectApiTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	/** @var list<array{0: NextcloudClient, 1: int}> Projects to remove before their folders go */
	private array $projects = [];
	/** @var list<string> */
	private array $users = [];

	protected function setUp(): void {
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
	}

	protected function tearDown(): void {
		foreach (array_reverse($this->projects) as [$client, $id]) {
			$client->ocs('DELETE', "/projects/$id");
		}
		foreach ($this->users as $user) {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		$this->nc->delete($this->root);
	}

	/** @return array<string, mixed> the created Project, registered for tearDown */
	private function createProject(NextcloudClient $client, int $folderId): array {
		$created = $client->ocs('POST', '/projects', ['folderId' => $folderId]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projects[] = [$client, $created['data']['id']];
		return $created['data'];
	}

	private function createUser(): NextcloudClient {
		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$created = $this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		self::assertSame(200, $created['status'], json_encode($created['data']));
		$this->users[] = $user;
		return $this->nc->withUser($user, $password);
	}

	/** @return array<string, list<array<string, mixed>>> Version Stacks by Asset name */
	private function stacks(NextcloudClient $client, int $projectId): array {
		$shown = $client->ocs('GET', "/projects/$projectId");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return array_column($shown['data']['assets'], 'versions', 'name');
	}

	/** @return list<string> the names of the Assets in a Member's No Project */
	private function unassigned(NextcloudClient $client): array {
		$shown = $client->ocs('GET', '/projects/0');
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		self::assertTrue($shown['data']['none']);
		return array_column($shown['data']['assets'], 'name');
	}

	public function testSingleFileIsEnabledWithoutItsFolderBecomingAProject(): void {
		$this->nc->mkdir("{$this->root}/scenes");
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/scenes/intro.mov", 'not really a video');
		$this->nc->put("{$this->root}/notes.txt", 'not media at all');
		$fileId = $this->nc->fileId("{$this->root}/cut.mp4");

		self::assertSame(404, $this->nc->ocs('GET', "/files/$fileId/asset")['status'], 'a plain file is no Asset');
		self::assertSame(409, $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/notes.txt")])['status'], 'only media files can be enabled');

		$enabled = $this->nc->ocs('POST', '/assets', ['fileId' => $fileId]);
		self::assertSame(201, $enabled['status'], json_encode($enabled['data']));
		self::assertSame(0, $enabled['data']['projectId'], 'with no Folder Project above it, the file goes to No Project');
		self::assertSame(404, $this->nc->ocs('GET', "/folders/{$this->nc->fileId($this->root)}/project")['status'], 'its folder does not become a Project (ADR 0009)');
		self::assertContains('cut', $this->unassigned($this->nc));
		self::assertNotContains('intro', $this->unassigned($this->nc), 'the other media files stay out');
		self::assertContains(0, array_column($this->nc->ocs('GET', '/projects')['data'], 'id'), 'No Project is listed while it holds something');

		// A Project by name collects files from anywhere, without moving them
		$named = $this->nc->ocs('POST', '/projects', ['name' => 'Showreel 2026']);
		self::assertSame(201, $named['status'], json_encode($named['data']));
		$projectId = $named['data']['id'];
		$this->projects[] = [$this->nc, $projectId];
		self::assertSame(['Showreel 2026', null, true], [$named['data']['name'], $named['data']['folderId'], $named['data']['canWrite']]);
		self::assertSame(400, $this->nc->ocs('POST', '/projects', ['name' => '  '])['status'], 'a Project needs a name');

		$intro = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/scenes/intro.mov"), 'projectId' => $projectId]);
		self::assertSame([201, $projectId], [$intro['status'], $intro['data']['projectId']], 'enabled straight into a Project');
		$assigned = $this->nc->ocs('PUT', "/assets/{$enabled['data']['assetId']}/project", ['projectId' => $projectId]);
		self::assertSame(200, $assigned['status'], json_encode($assigned['data']));
		self::assertSame(['cut', 'intro'], array_keys($this->stacks($this->nc, $projectId)));
		self::assertNotContains('cut', $this->unassigned($this->nc));
		self::assertSame('Showreel 2026', $this->nc->ocs('GET', "/files/$fileId/asset")['data']['projectName']);
		$paths = array_column($this->nc->ocs('GET', "/projects/$projectId")['data']['assets'], 'path', 'name');
		self::assertSame(['cut' => "/{$this->root}", 'intro' => "/{$this->root}/scenes"], $paths, 'without a folder of its own, paths run from home');

		self::assertSame(200, $this->nc->ocs('PUT', "/projects/$projectId", ['name' => 'Showreel'])['status']);
		self::assertSame(400, $this->nc->ocs('PUT', "/projects/$projectId", ['autoIntake' => true])['status'], 'only a Folder Project takes in a folder');

		// Removing the Project keeps every Asset, in No Project
		$commented = $this->nc->ocs('POST', "/versions/{$intro['data']['versionId']}/comments", ['inFrame' => 1, 'body' => 'keep me']);
		self::assertSame(201, $commented['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$projectId")['status']);
		self::assertSame(404, $this->nc->ocs('GET', "/projects/$projectId")['status']);
		self::assertContains('intro', $this->unassigned($this->nc));
		self::assertCount(1, $this->nc->ocs('GET', "/versions/{$intro['data']['versionId']}/comments")['data']['comments'], 'with its Comments');

		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$intro['data']['assetId']}")['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$enabled['data']['assetId']}")['status']);
		self::assertSame([], array_intersect(['cut', 'intro'], $this->unassigned($this->nc)), 'taken out of Deliver');
	}

	public function testAFileRemovedFromAFolderProjectStaysOutOfAutoIntake(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/other.mp4", 'not really a video');
		$this->nc->put("{$this->root}/trailer_v1.mp4", 'not really a video');
		$this->nc->put("{$this->root}/trailer_v2.mp4", 'not really a video');
		$projectId = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$shown = fn () => $this->nc->ocs('GET', "/projects/$projectId")['data'];
		$ids = array_column($shown()['assets'], 'id', 'name');
		self::assertSame(['cut', 'other', 'trailer'], array_keys($ids));

		// Removing a stacked Asset keeps every one of its files out, not just the newest
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$ids['cut']}")['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$ids['trailer']}")['status']);
		self::assertSame(['other'], array_column($shown()['assets'], 'name'), 'Auto Intake does not take them back (#45)');
		self::assertSame(['cut.mp4', 'trailer_v1.mp4', 'trailer_v2.mp4'], array_column($shown()['notEnabled'], 'name'), 'listed as not up for review although Auto Intake is on');

		// The mark follows the file, and new files still arrive on their own
		$this->nc->move("{$this->root}/cut.mp4", "{$this->root}/renamed.mp4");
		$this->nc->put("{$this->root}/renamed.mp4", 'overwritten');
		$this->nc->put("{$this->root}/new.mp4", 'not really a video');
		self::assertSame(200, $this->nc->ocs('PUT', "/projects/$projectId", ['autoIntake' => false])['status']);
		self::assertSame(200, $this->nc->ocs('PUT', "/projects/$projectId", ['autoIntake' => true])['status']);
		self::assertSame(['new', 'other'], array_column($shown()['assets'], 'name'));
		self::assertSame(['renamed.mp4', 'trailer_v1.mp4', 'trailer_v2.mp4'], array_column($shown()['notEnabled'], 'name'));

		// Added for review again, it is an Asset like any other
		$added = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/renamed.mp4")]);
		self::assertSame([201, $projectId], [$added['status'], $added['data']['projectId']], json_encode($added['data']));
		self::assertSame(['new', 'other', 'renamed'], array_column($shown()['assets'], 'name'));
		self::assertSame(['trailer_v1.mp4', 'trailer_v2.mp4'], array_column($shown()['notEnabled'], 'name'));
	}

	public function testAFolderProjectWithoutAutoIntakeTakesFilesOneByOne(): void {
		$this->nc->mkdir("{$this->root}/scenes");
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/scenes/intro.mov", 'not really a video');
		$this->nc->put("{$this->root}/scenes/voiceover.wav", 'not really audio');
		$project = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root), 'autoIntake' => false]);
		self::assertSame(201, $project['status'], json_encode($project['data']));
		$projectId = $project['data']['id'];
		$this->projects[] = [$this->nc, $projectId];
		self::assertSame([], $this->stacks($this->nc, $projectId));

		$enabled = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/cut.mp4")]);
		self::assertSame($projectId, $enabled['data']['projectId'], 'a file joins the Folder Project above it');
		$left = fn () => array_map(static fn (array $file) => [$file['path'], $file['name']], $this->nc->ocs('GET', "/projects/$projectId")['data']['notEnabled']);
		self::assertSame([['scenes', 'intro.mov'], ['scenes', 'voiceover.wav']], $left(), 'the Project view shows the others, to add one by one');

		$this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/scenes/intro.mov")]);
		self::assertSame(['cut', 'intro'], array_keys($this->stacks($this->nc, $projectId)));
		self::assertSame([['scenes', 'voiceover.wav']], $left());

		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$enabled['data']['assetId']}")['status']);
		self::assertSame(['intro'], array_keys($this->stacks($this->nc, $projectId)), 'taking one Asset out leaves the rest');
	}

	public function testAutoIntakeCanBeSwitchedOffAndKeepsWhatItCollected(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$project = $this->createProject($this->nc, $this->nc->fileId($this->root));
		self::assertTrue($project['autoIntake'], 'the folder switch turns Auto Intake on');
		self::assertSame(['cut'], array_keys($this->stacks($this->nc, $project['id'])));

		$off = $this->nc->ocs('PUT', "/projects/{$project['id']}", ['autoIntake' => false]);
		self::assertSame(200, $off['status'], json_encode($off['data']));
		self::assertFalse($off['data']['autoIntake']);

		$this->nc->put("{$this->root}/teaser.mp4", 'not really a video');
		self::assertSame(['cut'], array_keys($this->stacks($this->nc, $project['id'])), 'without Auto Intake a new file stays out');

		$teaser = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/teaser.mp4")]);
		self::assertSame($project['id'], $teaser['data']['projectId'], 'enabling by hand joins the Project that is there');
		self::assertSame(['cut', 'teaser'], array_keys($this->stacks($this->nc, $project['id'])));

		$this->nc->put("{$this->root}/b-roll.mp4", 'not really a video');
		$on = $this->nc->ocs('PUT', "/projects/{$project['id']}", ['autoIntake' => true]);
		self::assertTrue($on['data']['autoIntake']);
		self::assertSame(['b-roll', 'cut', 'teaser'], array_keys($this->stacks($this->nc, $project['id'])), 'back on, the rest of the folder follows');
	}

	public function testFolderOnAutoIntakeTakesEveryMediaFile(): void {
		$this->nc->mkdir("{$this->root}/scenes");
		// Nextcloud detects the mime type from the extension, so tiny stand-ins are enough here.
		$this->nc->put("{$this->root}/cut_v1.mp4", 'not really a video');
		$this->nc->put("{$this->root}/scenes/intro.mov", 'not really a video');
		$this->nc->put("{$this->root}/scenes/voiceover.wav", 'not really audio');
		$this->nc->put("{$this->root}/notes.txt", 'not media at all');
		$folderId = $this->nc->fileId($this->root);

		self::assertSame(404, $this->nc->ocs('GET', "/folders/$folderId/project")['status'], 'a plain folder is no Project');

		$project = $this->createProject($this->nc, $folderId);
		self::assertSame($this->root, $project['name']);
		self::assertSame($folderId, $project['folderId']);
		self::assertTrue($project['canWrite']);

		$byFolder = $this->nc->ocs('GET', "/folders/$folderId/project");
		self::assertSame(200, $byFolder['status']);
		self::assertSame($project['id'], $byFolder['data']['id']);
		self::assertSame([], $this->nc->ocs('GET', "/projects/{$project['id']}")['data']['notEnabled'], 'Auto Intake leaves nothing out');

		$listed = array_column($this->nc->ocs('GET', '/projects')['data'], 'id');
		self::assertContains($project['id'], $listed);

		$shown = $this->nc->ocs('GET', "/projects/{$project['id']}");
		self::assertSame(200, $shown['status']);
		$assets = array_map(
			static fn (array $asset) => [$asset['path'], $asset['name'], $asset['versions'][0]['number'], $asset['versions'][0]['state']],
			$shown['data']['assets'],
		);
		self::assertSame([
			// The filename convention names the Asset and numbers the Version
			['', 'cut', 1, 'ready'],
			['scenes', 'intro', 1, 'ready'],
			['scenes', 'voiceover', 1, 'ready'],
		], $assets, 'every video and audio file is an Asset with Version 1, the text file is not');

		// A file that arrives later becomes an Asset without any registration
		$this->nc->put("{$this->root}/b-roll.mp4", 'later arrival');
		$names = array_column($this->nc->ocs('GET', "/projects/{$project['id']}")['data']['assets'], 'name');
		self::assertContains('b-roll', $names);

		// A file that goes to the trash is Missing, not gone
		$this->nc->delete("{$this->root}/cut_v1.mp4");
		self::assertSame('missing', $this->stacks($this->nc, $project['id'])['cut'][0]['state']);

		self::assertSame(409, $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId("{$this->root}/scenes")])['status'], 'a folder inside a Project is refused');
		self::assertSame(409, $this->nc->ocs('POST', '/projects', ['folderId' => $folderId])['status'], 'a Project is not created twice');

		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/{$project['id']}")['status']);
		self::assertSame(404, $this->nc->ocs('GET', "/projects/{$project['id']}")['status']);
		self::assertSame(404, $this->nc->ocs('GET', "/folders/$folderId/project")['status']);
		self::assertContains('intro', $this->unassigned($this->nc), 'its Assets wait in No Project');
		foreach ($this->nc->ocs('GET', '/projects/0')['data']['assets'] as $asset) {
			if (in_array($asset['name'], ['intro', 'voiceover', 'b-roll', 'cut'], true)) {
				$this->nc->ocs('DELETE', "/assets/{$asset['id']}");
			}
		}
	}

	public function testReceivedShareBecomesProjectUnlessItSitsInsideOne(): void {
		$this->nc->mkdir("{$this->root}/scenes");
		$this->nc->put("{$this->root}/scenes/intro.mov", 'not really a video');
		$rootId = $this->nc->fileId($this->root);
		$scenesId = $this->nc->fileId("{$this->root}/scenes");

		$asMember = $this->createUser();
		$shared = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}/scenes",
			'shareType' => 0,
			'shareWith' => $this->users[0],
			'permissions' => 31,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));

		$project = $this->createProject($asMember, $scenesId);
		self::assertSame('scenes', $project['name'], 'a Member with write permission turns a received share into a Project');
		self::assertSame(200, $asMember->ocs('DELETE', "/projects/{$project['id']}")['status']);

		$asMember->mkdir('myproj');
		$this->createProject($asMember, $asMember->fileId('myproj'));
		$asMember->move('scenes', 'myproj/scenes');
		self::assertSame(409, $asMember->ocs('POST', '/projects', ['folderId' => $scenesId])['status'], 'the share was moved into a Project the owner cannot see');
		$asMember->move('myproj/scenes', 'scenes');

		$this->createProject($this->nc, $rootId);
		self::assertSame(409, $asMember->ocs('POST', '/projects', ['folderId' => $scenesId])['status'], 'the share sits inside a Project the Member cannot see');
		self::assertSame(404, $asMember->ocs('GET', "/folders/$scenesId/project")['status'], 'nothing was created');
	}

	public function testAFileKeepsItsProjectWhereverItMoves(): void {
		$this->nc->mkdir("{$this->root}/p1");
		$this->nc->mkdir("{$this->root}/p2");
		$this->nc->put("{$this->root}/p1/cut.mp4", 'not really a video');
		$p1 = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/p1"))['id'];
		$p2 = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/p2"))['id'];
		$before = $this->stacks($this->nc, $p1)['cut'][0];

		$this->nc->move("{$this->root}/p1/cut.mp4", "{$this->root}/p2/cut.mp4");

		$after = $this->stacks($this->nc, $p1)['cut'][0];
		self::assertSame([$before['id'], 'ready'], [$after['id'], $after['state']], 'same Version, same Project (ADR 0009)');
		self::assertSame([], $this->stacks($this->nc, $p2), 'Auto Intake does not take a file another Project holds');
		$path = array_column($this->nc->ocs('GET', "/projects/$p1")['data']['assets'], 'path', 'name')['cut'];
		self::assertSame("/{$this->root}/p2", $path, 'outside its folder, the path runs from home');
	}

	public function testProjectMovedIntoAnotherKeepsItsFilesToItself(): void {
		$this->nc->mkdir("{$this->root}/outer");
		$this->nc->mkdir("{$this->root}/inner");
		$this->nc->put("{$this->root}/inner/cut.mp4", 'not really a video');
		$outer = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/outer"))['id'];
		$inner = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/inner"))['id'];
		self::assertSame(['cut'], array_keys($this->stacks($this->nc, $inner)));

		// Files does not refuse the move yet; the outer Project must not claim the inner one's files
		$this->nc->move("{$this->root}/inner", "{$this->root}/outer/inner");

		self::assertSame([], $this->stacks($this->nc, $outer), 'a nested Project is skipped by the walk');
		self::assertSame('ready', $this->stacks($this->nc, $inner)['cut'][0]['state'], 'the nested Project still owns its Asset');
	}

	public function testOnlyFoldersBecomeProjects(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$fileId = $this->nc->fileId("{$this->root}/cut.mp4");
		self::assertSame(409, $this->nc->ocs('POST', '/projects', ['folderId' => $fileId])['status']);
		self::assertSame(404, $this->nc->ocs('POST', '/projects', ['folderId' => 999999999])['status']);
	}

	/** @return array<string, mixed> the Project's tile data as the client lists it */
	private function activity(NextcloudClient $client, int $projectId): array {
		$listed = $client->ocs('GET', '/projects');
		self::assertSame(200, $listed['status'], json_encode($listed['data']));
		return array_column($listed['data'], 'activity', 'id')[$projectId];
	}

	public function testProjectListTellsEachMemberWhatIsUnseen(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$project = $this->createProject($this->nc, $this->nc->fileId($this->root));
		$member = $this->createUser();
		$shared = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}",
			'shareType' => 0,
			'shareWith' => $member->user,
			'permissions' => 31,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
		$cut = $this->stacks($this->nc, $project['id'])['cut'][0]['id'];

		$comment = $member->ocs('POST', "/versions/$cut/comments", ['inFrame' => 3, 'body' => 'too dark']);
		self::assertSame(201, $comment['status'], json_encode($comment['data']));
		self::assertSame(200, $member->ocs('PUT', "/versions/$cut/approval", ['status' => 'changes'])['status']);
		$asset = $this->nc->ocs('GET', "/projects/{$project['id']}")['data']['assets'][0];
		self::assertSame(200, $this->nc->ocs('PUT', "/assets/{$asset['id']}", ['dueDate' => '2030-01-31'])['status']);

		$mine = $this->activity($this->nc, $project['id']);
		self::assertSame([1, 1, 1, '2030-01-31', null], [$mine['assets'], $mine['unseenComments'], $mine['changes'], $mine['nextDue'], $mine['still']], 'no video has been probed, so no still');
		self::assertSame(0, $this->activity($member, $project['id'])['unseenComments'], 'one\'s own Comment is not news');
		self::assertGreaterThanOrEqual($comment['data']['createdAt'], $mine['lastActivity']);
		self::assertGreaterThanOrEqual($comment['data']['createdAt'], $asset['lastActivity'], 'an Asset sorts by its latest Comment too');
		self::assertLessThanOrEqual($asset['lastActivity'], $asset['createdAt']);

		self::assertSame(200, $this->nc->ocs('POST', "/versions/$cut/seen")['status']);
		self::assertSame(0, $this->activity($this->nc, $project['id'])['unseenComments'], 'having it on screen clears it');
	}
}
