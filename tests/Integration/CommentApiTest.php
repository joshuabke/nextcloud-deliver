<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Comments over the real HTTP API: anchors are Frames, reading the folder is
 * enough to comment, writing it is needed to resolve or to touch someone else's.
 */
class CommentApiTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private int $versionId;
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
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');

		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
		$this->versionId = $this->stack('cut')[0]['id'];
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		foreach ($this->users as $user) {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}
		$this->nc->delete($this->root);
	}

	/** @return list<array<string, mixed>> the Version Stack of one Asset */
	private function stack(string $name): array {
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return array_column($shown['data']['assets'], 'versions', 'name')[$name];
	}

	/** A second account with the Project folder shared to it */
	private function member(int $permissions): NextcloudClient {
		$user = 'deliver-member-' . bin2hex(random_bytes(4));
		$password = 'Member-' . bin2hex(random_bytes(8));
		$created = $this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => $password]);
		self::assertSame(200, $created['status'], json_encode($created['data']));
		$this->users[] = $user;
		$shared = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', [
			'path' => "/{$this->root}",
			'shareType' => 0,
			'shareWith' => $user,
			'permissions' => $permissions,
		]);
		self::assertSame(200, $shared['status'], json_encode($shared['data']));
		return $this->nc->withUser($user, $password);
	}

	private function comment(NextcloudClient $client, array $fields): array {
		$created = $client->ocs('POST', "/versions/{$this->versionId}/comments", $fields);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data'];
	}

	public function testACommentCarriesADrawing(): void {
		$shapes = [['tool' => 'arrow', 'color' => '#ff0000', 'points' => [[0.1, 0.1], [0.5, 0.4]]]];
		$drawn = $this->comment($this->nc, ['inFrame' => 12, 'body' => 'this logo', 'annotation' => $shapes]);
		self::assertSame($shapes, $drawn['annotation']);
		$listed = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments'];
		self::assertSame($shapes, $listed[0]['annotation']);

		$broken = $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'x', 'annotation' => [['tool' => 'spray']]]);
		self::assertSame(400, $broken['status']);
		$reply = $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'x', 'parentId' => $drawn['id'], 'annotation' => $shapes]);
		self::assertSame(400, $reply['status'], 'a Reply carries no drawing');
		self::assertNull($this->comment($this->nc, ['inFrame' => 3, 'body' => 'plain'])['annotation']);
	}

	public function testReactionsToggleAndTravelWithTheComment(): void {
		$comment = $this->comment($this->nc, ['inFrame' => 4, 'body' => 'nice grade']);
		$reader = $this->member(1);
		$react = static fn (NextcloudClient $who, string $emoji, bool $on) => $who->ocs('PUT', "/comments/{$comment['id']}/reactions", ['emoji' => $emoji, 'on' => $on]);

		$react($this->nc, '👍', true);
		$reacted = $react($reader, '👍', true);
		self::assertSame(200, $reacted['status'], json_encode($reacted['data']));
		self::assertSame('👍', $reacted['data']['reactions'][0]['emoji']);
		self::assertCount(2, $reacted['data']['reactions'][0]['authors']);
		// Twice is still once
		self::assertCount(2, $react($reader, '👍', true)['data']['reactions'][0]['authors']);

		// The Comment counts as changed, so the next poll brings it
		$changes = $this->nc->ocs('GET', "/versions/{$this->versionId}/changes?since=" . (time() - 1))['data']['comments'];
		self::assertSame([$comment['id']], array_column($changes, 'id'));

		// Taking mine back leaves the other person's
		$left = $react($this->nc, '👍', false)['data']['reactions'];
		self::assertCount(1, $left[0]['authors']);
		self::assertNotSame('admin', $left[0]['authors'][0]['id']);
		self::assertSame(200, $react($this->nc, '🦷', true)['status'], 'any emoji');
		$given = $react($this->nc, '👍🏽', true)['data']['reactions'];
		self::assertSame(['👍', '🦷', '👍🏽'], array_column($given, 'emoji'), 'the usual ones first, then as they were given');
		self::assertSame(400, $react($this->nc, 'ok', true)['status'], 'text is no reaction');
		self::assertSame(400, $react($this->nc, '<b>👍</b>', true)['status']);
	}

	public function testAttachmentsLiveInAppDataNotInFiles(): void {
		$comment = $this->comment($this->nc, ['inFrame' => 7, 'body' => 'like this']);
		$attached = $this->nc->upload("/comments/{$comment['id']}/attachments", 'reference.png', 'not really a picture');
		self::assertSame(201, $attached['status'], json_encode($attached['data']));
		self::assertSame(['reference.png', 20], [$attached['data']['attachments'][0]['name'], $attached['data']['attachments'][0]['size']]);
		$id = $attached['data']['attachments'][0]['id'];

		// Kept in app data (ADR 0009): nothing appears in Files, so nothing becomes an Asset, and a second of the same name is its own
		$again = $this->nc->upload("/comments/{$comment['id']}/attachments", 'reference.png', 'a second one');
		self::assertSame('reference.png', $again['data']['attachments'][1]['name']);
		self::assertSame(404, $this->nc->request('PROPFIND', "/remote.php/dav/files/admin/{$this->root}/.deliver-attachments")['status']);
		self::assertSame(['cut'], array_column($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], 'name'));
		$downloaded = $this->nc->request('GET', "/index.php/apps/deliver/attachments/$id");
		self::assertSame([200, 'not really a picture'], [$downloaded['status'], $downloaded['body']]);
		$second = $this->nc->request('GET', "/index.php/apps/deliver/attachments/{$again['data']['attachments'][1]['id']}");
		self::assertSame('a second one', $second['body']);

		$odd = $this->nc->upload("/comments/{$comment['id']}/attachments", '..', 'x');
		self::assertSame([201, 'attachment'], [$odd['status'], $odd['data']['attachments'][2]['name']], 'a name that is only dots becomes a plain one');

		// Someone else's Comment takes no attachments from me
		$reader = $this->member(1);
		self::assertSame(403, $reader->upload("/comments/{$comment['id']}/attachments", 'x.txt', 'x')['status']);
		self::assertSame(200, $reader->request('GET', "/index.php/apps/deliver/attachments/$id")['status'], 'but it may read them');

		// Deleting the Comment deletes its files
		$this->nc->ocs('DELETE', "/comments/{$comment['id']}");
		self::assertSame(404, $this->nc->request('GET', "/index.php/apps/deliver/attachments/$id")['status']);
	}

	public function testCommentsAnchorToFramesAndRanges(): void {
		$frame = $this->comment($this->nc, ['inFrame' => 120, 'body' => 'colour is off here']);
		self::assertSame([120, null], [$frame['inFrame'], $frame['outFrame']]);
		self::assertSame('admin', $frame['author']['id']);
		self::assertFalse($frame['resolved']);

		$range = $this->comment($this->nc, ['inFrame' => 300, 'outFrame' => 360, 'body' => 'shorten this passage']);
		self::assertSame([300, 360], [$range['inFrame'], $range['outFrame']]);

		$listed = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments");
		self::assertSame(200, $listed['status']);
		self::assertSame([120, 300], array_column($listed['data']['comments'], 'inFrame'), 'Frame order, the way the marker strip reads');
		self::assertTrue($listed['data']['canWrite']);

		self::assertSame(400, $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 10, 'body' => '  '])['status'], 'an empty body is refused');
		self::assertSame(400, $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 400, 'outFrame' => 200, 'body' => 'backwards'])['status'], 'a Range runs forwards');
		self::assertSame(404, $this->nc->ocs('POST', '/versions/999999/comments', ['inFrame' => 1, 'body' => 'nowhere'])['status']);
	}

	public function testRepliesShareTheirParentsAnchorAndDoNotNest(): void {
		$parent = $this->comment($this->nc, ['inFrame' => 90, 'outFrame' => 120, 'body' => 'this cut is late']);
		$reply = $this->comment($this->nc, ['inFrame' => 5, 'body' => 'agreed', 'parentId' => $parent['id']]);

		self::assertSame($parent['id'], $reply['parentId']);
		self::assertSame([90, 120], [$reply['inFrame'], $reply['outFrame']], 'a Reply takes the anchor of its parent');

		$nested = $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 5, 'body' => 'nope', 'parentId' => $reply['id']]);
		self::assertSame(400, $nested['status'], 'Replies do not carry Replies');

		// Removing the parent takes its Replies with it
		self::assertSame(200, $this->nc->ocs('DELETE', "/comments/{$parent['id']}")['status']);
		self::assertSame([], $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['comments']);
	}

	public function testReadAccessCommentsWriteAccessResolves(): void {
		$asReader = $this->member(1);
		$readerComment = $this->comment($asReader, ['inFrame' => 42, 'body' => 'from the client']);
		self::assertFalse($asReader->ocs('GET', "/versions/{$this->versionId}/comments")['data']['canWrite']);

		$edited = $asReader->ocs('PUT', "/comments/{$readerComment['id']}", ['body' => 'from the client, corrected']);
		self::assertSame('from the client, corrected', $edited['data']['body'], 'authors edit their own');

		self::assertSame(403, $this->nc->ocs('PUT', "/comments/{$readerComment['id']}", ['body' => 'not mine'])['status'], 'nobody edits a Comment they did not write');
		self::assertSame(403, $asReader->ocs('PUT', "/comments/{$readerComment['id']}/resolved", ['resolved' => true])['status'], 'resolving needs write access');

		$resolved = $this->nc->ocs('PUT', "/comments/{$readerComment['id']}/resolved", ['resolved' => true]);
		self::assertSame(200, $resolved['status'], json_encode($resolved['data']));
		self::assertTrue($resolved['data']['resolved']);

		$ownComment = $this->comment($this->nc, ['inFrame' => 7, 'body' => 'mine']);
		self::assertSame(403, $asReader->ocs('DELETE', "/comments/{$ownComment['id']}")['status'], 'a reader removes only their own');
		self::assertSame(200, $this->nc->ocs('DELETE', "/comments/{$readerComment['id']}")['status'], 'write access removes any');
	}

	public function testChangesSinceCarriesNewCommentsAndTheSurvivingIds(): void {
		$first = $this->comment($this->nc, ['inFrame' => 10, 'body' => 'one']);
		$now = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['now'];

		// Timestamps count seconds; wait one so "after now" is unambiguous
		sleep(1);
		$second = $this->comment($this->nc, ['inFrame' => 20, 'body' => 'two']);
		$changes = $this->nc->ocs('GET', "/versions/{$this->versionId}/changes?since=" . ($now + 1));
		self::assertSame(200, $changes['status'], json_encode($changes['data']));
		self::assertSame([$second['id']], array_column($changes['data']['comments'], 'id'), 'only what changed since');
		self::assertSame([$first['id'], $second['id']], $changes['data']['ids'], 'every Comment that still exists');
		self::assertSame('ready', $changes['data']['state']);

		self::assertSame(200, $this->nc->ocs('DELETE', "/comments/{$first['id']}")['status']);
		$after = $this->nc->ocs('GET', "/versions/{$this->versionId}/changes?since=" . ($now + 1));
		self::assertSame([$second['id']], $after['data']['ids'], 'a deleted Comment drops out of the id list');
	}

	public function testUnseenMarkMovesForwardOnly(): void {
		$listed = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments");
		self::assertSame(0, $listed['data']['seenUntil'], 'nothing has been on screen yet');

		$marked = $this->nc->ocs('POST', "/versions/{$this->versionId}/seen", ['at' => 1000]);
		self::assertSame(1000, $marked['data']['seenUntil']);
		self::assertSame(1000, $this->nc->ocs('POST', "/versions/{$this->versionId}/seen", ['at' => 500])['data']['seenUntil'], 'the mark never moves back');
		self::assertSame(2000, $this->nc->ocs('POST', "/versions/{$this->versionId}/seen", ['at' => 2000])['data']['seenUntil']);

		self::assertSame(2000, $this->nc->ocs('GET', "/versions/{$this->versionId}/comments")['data']['seenUntil']);
	}

	public function testOlderVersionsTakeCommentsOnlyWhenTheProjectSaysSo(): void {
		$older = $this->comment($this->nc, ['inFrame' => 1, 'body' => 'on Version 1']);
		$this->nc->put("{$this->root}/cut_v2.mp4", 'not really a video');
		[$newest, $first] = $this->stack('cut');
		self::assertSame($this->versionId, $first['id'], 'cut_v2 stacked on top');

		$listed = $this->nc->ocs('GET', "/versions/{$this->versionId}/comments");
		self::assertFalse($listed['data']['canComment'], 'the client knows before it tries');
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 2, 'body' => 'late'])['status']);
		self::assertSame(409, $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 1, 'body' => 'late', 'parentId' => $older['id']])['status'], 'a Reply is a Comment too');
		self::assertSame(201, $this->nc->ocs('POST', "/versions/{$newest['id']}/comments", ['inFrame' => 2, 'body' => 'on the newest'])['status']);

		$settings = $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['allowOlder' => true, 'timecodeMode' => 'frames', 'fpsNum' => 24000, 'fpsDen' => 1001]);
		self::assertSame(200, $settings['status'], json_encode($settings['data']));
		self::assertTrue($settings['data']['allowOlder']);
		self::assertSame('frames', $settings['data']['timecodeMode']);
		self::assertSame(['num' => 24000, 'den' => 1001], $settings['data']['fps'], 'a Project carries its own frame rate');
		self::assertSame(201, $this->nc->ocs('POST', "/versions/{$this->versionId}/comments", ['inFrame' => 2, 'body' => 'now allowed'])['status']);

		self::assertSame(400, $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['timecodeMode' => 'sundial'])['status']);
		self::assertSame(400, $this->nc->ocs('PUT', "/projects/{$this->projectId}", ['fpsNum' => 0])['status']);
	}

	public function testAnAuthorDoesNotDeleteOtherPeoplesReplies(): void {
		$asReader = $this->member(1);
		$question = $this->comment($asReader, ['inFrame' => 3, 'body' => 'is this the final grade?']);
		$this->comment($this->nc, ['inFrame' => 3, 'body' => 'yes', 'parentId' => $question['id']]);

		self::assertSame(403, $asReader->ocs('DELETE', "/comments/{$question['id']}")['status'], 'the answer is not theirs to delete');
		self::assertSame(200, $this->nc->ocs('DELETE', "/comments/{$question['id']}")['status'], 'write access still can');
	}

	public function testReadAccessChangesNothingButComments(): void {
		$asReader = $this->member(1);
		self::assertSame(403, $asReader->ocs('PUT', "/projects/{$this->projectId}", ['autoIntake' => false])['status']);
		self::assertSame(403, $asReader->ocs('POST', "/versions/{$this->versionId}/regenerate")['status']);
		self::assertSame(403, $asReader->ocs('DELETE', "/projects/{$this->projectId}")['status']);
	}

	public function testCommentsExportForTheEditingApplication(): void {
		$open = $this->comment($this->nc, ['inFrame' => 50, 'outFrame' => 74, 'body' => 'longer please']);
		$this->comment($this->nc, ['inFrame' => 50, 'body' => 'agreed', 'parentId' => $open['id']]);
		$done = $this->comment($this->nc, ['inFrame' => 10, 'body' => 'logo too small']);
		$this->nc->ocs('PUT', "/comments/{$done['id']}/resolved", ['resolved' => true]);
		$export = "/apps/deliver/versions/{$this->versionId}/export";

		$edl = $this->nc->request('GET', "$export/edl");
		self::assertSame(200, $edl['status']);
		self::assertStringStartsWith('TITLE: cut v1', $edl['body']);
		self::assertSame(2, substr_count($edl['body'], '|M:'), 'one marker per Comment, Replies folded in');
		self::assertStringContainsString('|M:admin: longer please / admin: agreed |D:25', $edl['body']);

		$open = $this->nc->request('GET', "$export/edl?unresolvedOnly=1");
		self::assertSame(1, substr_count($open['body'], '|M:'), 'unresolved only');

		$xml = simplexml_load_string($this->nc->request('GET', "$export/fcpxml?zeroBased=1")['body']);
		self::assertNotFalse($xml);
		self::assertSame('00:00:00:00', (string)$xml->sequence->timecode->string);
		self::assertCount(2, $xml->sequence->media->video->track->clipitem->marker);

		$fcpx = simplexml_load_string($this->nc->request('GET', "$export/fcpx")['body']);
		self::assertNotFalse($fcpx);
		self::assertCount(2, $fcpx->library->event->project->sequence->spine->{'asset-clip'}->marker);

		self::assertStringStartsWith('frame_in,frame_out', $this->nc->request('GET', "$export/csv")['body']);
		self::assertSame(400, $this->nc->request('GET', "$export/aaf")['status']);
		self::assertSame(403, $this->member(1)->request('GET', "$export/edl")['status'], 'exporting needs write access');
	}
}
