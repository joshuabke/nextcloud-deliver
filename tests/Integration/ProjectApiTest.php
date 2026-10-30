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
			$client->deleteProject($id);
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
		self::assertSame(['Showreel 2026', null, true], [$named['data']['name'], $named['data']['folderId'], $named['data']['manages']]);
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

		// Deleted, the Project is kept whole under Deleted Projects, and nobody opens it (ADR 0015)
		$commented = $this->nc->ocs('POST', "/versions/{$intro['data']['versionId']}/comments", ['inFrame' => 1, 'body' => 'keep me']);
		self::assertSame(201, $commented['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$projectId")['status']);
		self::assertSame(404, $this->nc->ocs('GET', "/projects/$projectId")['status']);
		self::assertNotContains('intro', $this->unassigned($this->nc), 'its Assets do not go to No Project');
		self::assertSame(404, $this->nc->ocs('GET', "/versions/{$intro['data']['versionId']}/comments")['status']);
		self::assertSame(404, $this->nc->ocs('GET', "/files/$fileId/asset")['status']);

		self::assertSame(200, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status']);
		self::assertSame(['cut', 'intro'], array_keys($this->stacks($this->nc, $projectId)));
		self::assertCount(1, $this->nc->ocs('GET', "/versions/{$intro['data']['versionId']}/comments")['data']['comments'], 'restored with its Comments');
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

	public function testADeletedAssetTakesItsFilesToTheTrashAndLeavesNoMissingBehind(): void {
		$this->nc->emptyTrash();
		$this->nc->put("{$this->root}/cut_v1.mp4", 'not really a video');
		$this->nc->put("{$this->root}/cut_v2.mp4", 'not really a video');
		$this->nc->put("{$this->root}/other.mp4", 'not really a video');
		$projectId = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$shown = fn (NextcloudClient $client) => $client->ocs('GET', "/projects/$projectId")['data'];
		$ids = array_column($shown($this->nc)['assets'], 'id', 'name');
		self::assertSame(['cut', 'other'], array_keys($ids));

		// A Member who may change the files but not delete them is refused, and nothing goes
		$asMember = $this->createUser();
		$shared = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}",
			'shareType' => 0,
			'shareWith' => end($this->users),
			'permissions' => 7,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
		self::assertSame(403, $asMember->ocs('DELETE', "/assets/{$ids['cut']}/files")['status']);
		self::assertSame(['cut', 'other'], array_column($shown($this->nc)['assets'], 'name'));

		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$ids['cut']}/files")['status']);
		$after = $shown($this->nc);
		self::assertSame(['other'], array_column($after['assets'], 'name'), 'gone at once, not Missing (story 141)');
		self::assertSame([], $after['notEnabled'], 'its files left the folder');
		$trash = $this->nc->request('PROPFIND', '/remote.php/dav/trashbin/' . rawurlencode(getenv('DELIVER_TEST_USER') ?: 'admin') . '/trash', null, ['Depth: 1'])['body'];
		self::assertStringContainsString('cut_v1.mp4', $trash, 'in the trash of Files');
		self::assertStringContainsString('cut_v2.mp4', $trash);

		// An Asset whose file is in the trash already is still the Members' to delete, and goes without a trace
		$this->nc->delete("{$this->root}/other.mp4");
		[$missing] = $shown($this->nc)['assets'];
		self::assertSame(['missing', true], [$missing['versions'][0]['state'], $missing['manages']]);
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/{$ids['other']}/files")['status']);
		self::assertSame([], $shown($this->nc)['assets']);
	}

	public function testAFolderOrFileOfADeletedProjectOffersItBack(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/other.mp4", 'not really a video');
		$folderId = $this->nc->fileId($this->root);
		$projectId = $this->createProject($this->nc, $folderId)['id'];
		$ids = array_column($this->nc->ocs('GET', "/projects/$projectId")['data']['assets'], 'id', 'name');
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$projectId")['status']);

		// It holds its files: made a Project again, or enabled, the folder offers it back (story 149)
		$again = $this->nc->ocs('POST', '/projects', ['folderId' => $folderId]);
		self::assertSame([409, 'deleted', $projectId], [$again['status'], $again['data']['reason'] ?? null, $again['data']['projectId'] ?? null], json_encode($again['data']));
		self::assertSame([409, 'deleted'], [($enabled = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/cut.mp4")]))['status'], $enabled['data']['reason'] ?? null]);
		$this->nc->put("{$this->root}/loose.mp4", 'not really a video');
		self::assertSame(409, $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/loose.mp4")])['status'], 'nor is a new file of its folder enabled elsewhere');
		// Whoever may not change it learns only that a Project holds the file
		$other = $this->createUser();
		$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}/other.mp4", 'shareType' => 0, 'shareWith' => end($this->users), 'permissions' => 3]);
		$refused = $other->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/other.mp4")]);
		self::assertSame([409, null, null], [$refused['status'], $refused['data']['reason'] ?? null, $refused['data']['projectName'] ?? null], json_encode($refused['data']));

		self::assertSame(200, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status']);
		self::assertSame($ids, array_intersect_key(array_column($this->nc->ocs('GET', "/projects/$projectId")['data']['assets'], 'id', 'name'), $ids), 'restored, its Assets are the same');

		// Deleted for good, the folder starts afresh
		$this->nc->ocs('DELETE', "/projects/$projectId");
		self::assertSame(200, $this->nc->ocs('DELETE', "/deleted-projects/$projectId")['status']);
		$fresh = $this->createProject($this->nc, $folderId)['id'];
		$names = array_column($this->nc->ocs('GET', "/projects/$fresh")['data']['assets'], 'id', 'name');
		self::assertSame(['cut', 'loose', 'other'], array_keys($names));
		self::assertNotContains($ids['cut'], $names);
	}

	public function testAFileInReviewElsewhereIsNotHeldByTheDeletedProjectAroundIt(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$folderProject = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$named = $this->nc->ocs('POST', '/projects', ['name' => 'Elsewhere'])['data']['id'];
		$this->projects[] = [$this->nc, $named];
		$assetId = $this->nc->ocs('GET', "/projects/$folderProject")['data']['assets'][0]['id'];
		self::assertSame(200, $this->nc->ocs('PUT', "/assets/$assetId/project", ['projectId' => $named])['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$folderProject")['status']);

		$enabled = $this->nc->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/cut.mp4")]);
		self::assertSame([201, $named], [$enabled['status'], $enabled['data']['projectId'] ?? null], json_encode($enabled['data']));
	}

	public function testADeletedProjectIsKeptWholeAndRestored(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$projectId = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$versionId = $this->nc->ocs('GET', "/projects/$projectId")['data']['assets'][0]['versions'][0]['id'];
		$link = $this->nc->ocs('POST', "/projects/$projectId/links")['data'];
		$leon = $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Leon'])['data'];
		$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		self::assertSame(200, $visitor->call('GET', "/api/context?versionId=$versionId&r={$leon['key']}")['status']);

		$before = time();
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$projectId")['status']);
		self::assertNotContains($projectId, array_column($this->nc->ocs('GET', '/projects')['data'], 'id'), 'gone from the Project list');
		self::assertSame(404, $visitor->call('GET', "/api/context?versionId=$versionId&r={$leon['key']}")['status'], 'its Review Links are closed');
		$listed = array_column($this->nc->ocs('GET', '/deleted-projects')['data']['projects'], null, 'id')[$projectId] ?? null;
		self::assertNotNull($listed, 'listed under Deleted Projects (story 148)');
		self::assertSame([$this->root, 'admin'], [$listed['name'], $listed['deletedBy']]);
		self::assertGreaterThanOrEqual($before, $listed['deletedAt']);
		self::assertSame($listed['deletedAt'] + 30 * 86400, $listed['goesAt'], 'for 30 days unless the admin set otherwise');
		self::assertSame(404, $this->createUser()->ocs('POST', "/deleted-projects/$projectId/restore")['status'], 'only whoever may change it knows of it');
		self::assertSame(404, $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Mia', 'email' => 'mia@example.com', 'sendMail' => true])['status'], 'nobody is invited meanwhile');
		self::assertSame(404, $this->nc->ocs('GET', "/projects/$projectId/links")['status'], 'nor its links and Reviewers listed');

		self::assertSame(200, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status']);
		self::assertSame(200, $visitor->call('GET', "/api/context?versionId=$versionId&r={$leon['key']}")['status'], 'its Review Links as they were');
		self::assertSame(404, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status'], 'once');
	}

	public function testADeletedProjectWhoseFolderWentToTheTrashStaysWithWhoeverDeletedIt(): void {
		$this->nc->mkdir("{$this->root}/spot");
		$projectId = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/spot"))['id'];
		$this->nc->ocs('DELETE', "/projects/$projectId");
		$this->nc->delete("{$this->root}/spot");
		self::assertContains($projectId, array_column($this->nc->ocs('GET', '/deleted-projects')['data']['projects'], 'id'));
		self::assertSame(200, $this->nc->ocs('DELETE', "/deleted-projects/$projectId")['status']);
	}

	public function testAProjectWithAnAssetTheMemberMayNotChangeIsNotDeleted(): void {
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$asMember = $this->createUser();
		$share = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}/cut.mp4", 'shareType' => 0, 'shareWith' => end($this->users), 'permissions' => 3]);
		$named = $asMember->ocs('POST', '/projects', ['name' => 'Borrowed'])['data']['id'];
		$this->projects[] = [$asMember, $named];
		self::assertSame(201, $asMember->ocs('POST', '/assets', ['fileId' => $this->nc->fileId("{$this->root}/cut.mp4"), 'projectId' => $named])['status']);
		// The file is out of their reach since
		$this->nc->ocsForm('DELETE', "/ocs/v2.php/apps/files_sharing/api/v1/shares/{$share['data']['id']}");

		$refused = $asMember->ocs('DELETE', "/projects/$named");
		self::assertSame(403, $refused['status']);
		self::assertStringContainsString('1 Asset you cannot open', $refused['data']['message'], 'counting the Asset');
		self::assertStringNotContainsString('cut', $refused['data']['message'], 'whose name only whoever can open it sees');
		self::assertSame(200, $asMember->ocs('GET', "/projects/$named")['status'], 'and nothing went');
	}

	public function testDeletedProjectsGoForGoodWhenTheirTimeIsUp(): void {
		self::assertSame(400, $this->nc->ocs('PUT', '/admin/settings', ['deletedDays' => 0])['status'], 'a day at least');
		$days = $this->nc->ocs('GET', '/admin/settings')['data']['settings']['deletedDays'];
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$projectId = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$versionId = $this->nc->ocs('GET', "/projects/$projectId")['data']['assets'][0]['versions'][0]['id'];
		$this->nc->ocs('DELETE', "/projects/$projectId");
		try {
			self::assertSame(200, $this->nc->ocs('PUT', '/admin/settings', ['deletedDays' => 2])['status']);
			$this->inNextcloud("\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeStatement('UPDATE *PREFIX*deliver_projects SET deleted_at = deleted_at - 86400 WHERE id = $projectId');");
			$this->inNextcloud('\\OCP\\Server::get(\\OCA\\Deliver\\Service\\ProjectService::class)->scanAll();');
			self::assertContains($projectId, array_column($this->nc->ocs('GET', '/deleted-projects')['data']['projects'], 'id'), 'a day of two');

			$this->inNextcloud("\\OCP\\Server::get(\\OCP\\IDBConnection::class)->executeStatement('UPDATE *PREFIX*deliver_projects SET deleted_at = deleted_at - 86400 WHERE id = $projectId');");
			$this->inNextcloud('\\OCP\\Server::get(\\OCA\\Deliver\\Service\\ProjectService::class)->scanAll();');
			self::assertNotContains($projectId, array_column($this->nc->ocs('GET', '/deleted-projects')['data']['projects'], 'id'), 'gone for good after two days');
			self::assertSame(404, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status']);
			$this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
			self::assertNotContains($versionId, array_column(array_merge(...array_column($this->nc->ocs('GET', '/projects/' . $this->projectOf($this->root))['data']['assets'], 'versions')), 'id'), 'its file taken in afresh');
		} finally {
			$this->nc->ocs('PUT', '/admin/settings', ['deletedDays' => $days]);
		}
	}

	/** Runs PHP inside this Nextcloud, for what no API does: the days passing */
	private function inNextcloud(string $code): void {
		exec('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; \\OCP\\Server::get(\\OCP\\App\\IAppManager::class)->loadApp("deliver"); ' . $code) . ' 2>&1', $output, $status);
		self::assertSame(0, $status, implode("\n", $output));
	}

	/** @return int the Folder Project of a folder, registered for tearDown */
	private function projectOf(string $path): int {
		$id = $this->nc->ocs('GET', "/folders/{$this->nc->fileId($path)}/project")['data']['id'];
		$this->projects[] = [$this->nc, $id];
		return $id;
	}

	public function testADeletedProjectGoesForGoodWithAllItsDataAndTheFilesStay(): void {
		$this->nc->put("{$this->root}/cut_v1.mp4", 'not really a video');
		$this->nc->put("{$this->root}/cut_v2.mp4", 'not really a video');
		$this->nc->put("{$this->root}/other.mp4", 'not really a video');
		$projectId = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$assets = $this->nc->ocs('GET', "/projects/$projectId")['data']['assets'];
		$versionId = $assets[0]['versions'][0]['id'];
		$this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => 1, 'body' => 'note']);
		$link = $this->nc->ocs('POST', "/projects/$projectId/links")['data'];
		$invited = $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Leon'])['data'];

		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$projectId")['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/deleted-projects/$projectId")['status']);
		array_pop($this->projects);
		self::assertSame(404, $this->nc->ocs('POST', "/deleted-projects/$projectId/restore")['status']);
		self::assertSame([], array_intersect(['cut', 'other'], $this->unassigned($this->nc)), 'not in No Project (story 150)');
		self::assertSame(404, $this->nc->ocs('GET', "/versions/$versionId/comments")['status'], 'its review data is gone');
		self::assertSame(404, $this->nc->ocs('PUT', "/reviewers/{$invited['id']}", ['name' => 'Leon'])['status'], 'and its Reviewers');
		self::assertSame($assets[0]['versions'][0]['fileId'], $this->nc->fileId("{$this->root}/cut_v2.mp4"), 'the files stay where they were');

		// Made again, the folder takes its files in afresh
		$again = $this->createProject($this->nc, $this->nc->fileId($this->root))['id'];
		$fresh = $this->nc->ocs('GET', "/projects/$again")['data']['assets'];
		self::assertSame(['cut', 'other'], array_column($fresh, 'name'));
		self::assertSame(0, $fresh[0]['versions'][0]['comments'], 'without the old Comments');
	}

	public function testAReviewerWhoseCommentsMovedOnKeepsTheirNameWhenTheProjectIsDeleted(): void {
		$this->nc->mkdir("{$this->root}/spot");
		$this->nc->put("{$this->root}/spot/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/spot/other.mp4", 'not really a video');
		$spot = $this->createProject($this->nc, $this->nc->fileId("{$this->root}/spot"))['id'];
		$assets = array_column($this->nc->ocs('GET', "/projects/$spot")['data']['assets'], null, 'name');
		$link = $this->nc->ocs('POST', "/projects/$spot/links")['data'];
		$mara = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$mara->call('POST', '/api/reviewer', ['name' => 'Mara']);
		$cutVersion = $assets['cut']['versions'][0]['id'];
		self::assertSame(201, $mara->call('POST', "/api/versions/$cutVersion/comments", ['inFrame' => 2, 'body' => 'warmer'])['status']);
		$mara->call('POST', "/api/versions/{$assets['other']['versions'][0]['id']}/comments", ['inFrame' => 2, 'body' => 'gone with it']);

		// The cut moves on to the showreel, Mara's Comment with it
		$showreel = $this->nc->ocs('POST', '/projects', ['name' => 'Showreel ' . bin2hex(random_bytes(3))])['data']['id'];
		$this->projects[] = [$this->nc, $showreel];
		self::assertSame(200, $this->nc->ocs('PUT', "/assets/{$assets['cut']['id']}/project", ['projectId' => $showreel])['status']);

		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/$spot")['status']);
		self::assertSame(200, $this->nc->ocs('DELETE', "/deleted-projects/$spot")['status']);
		$this->projects = array_values(array_filter($this->projects, static fn (array $each) => $each[1] !== $spot));
		$comments = $this->nc->ocs('GET', "/versions/$cutVersion/comments")['data']['comments'];
		self::assertSame([['warmer', 'Mara']], array_map(static fn (array $comment) => [$comment['body'], $comment['author']['name']], $comments), 'its author stays named');
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
		// Nextcloud files a playlist under audio, but it only points at other files
		$this->nc->put("{$this->root}/scenes/takes.m3u8", "#EXTM3U\nvoiceover.wav\n");
		$folderId = $this->nc->fileId($this->root);

		self::assertSame(404, $this->nc->ocs('GET', "/folders/$folderId/project")['status'], 'a plain folder is no Project');

		$project = $this->createProject($this->nc, $folderId);
		self::assertSame($this->root, $project['name']);
		self::assertSame($folderId, $project['folderId']);
		self::assertTrue($project['manages']);

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
		self::assertNotContains('intro', $this->unassigned($this->nc), 'its Assets stay with it, under Deleted Projects');
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
		self::assertSame('deleted', $this->nc->ocs('POST', '/projects', ['folderId' => $rootId])['data']['reason'] ?? null, 'a Deleted Project inside is offered back');
		self::assertSame(200, $asMember->ocs('DELETE', "/deleted-projects/{$project['id']}")['status']);

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

		// Removed while it lies outside the folder, it is not marked there: back inside, Auto Intake takes it (story 132)
		$assetId = array_column($this->nc->ocs('GET', "/projects/$p1")['data']['assets'], 'id', 'name')['cut'];
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/$assetId")['status']);
		$this->nc->move("{$this->root}/p2/cut.mp4", "{$this->root}/p1/cut.mp4");
		self::assertSame(['cut'], array_keys($this->stacks($this->nc, $p1)));
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
