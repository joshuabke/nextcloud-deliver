<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Version Stacks over the HTTP API: the filename convention suggests, a Member
 * decides, and Files decides what still exists (spec: Versions).
 */
class StackApiTest extends TestCase {
	private NextcloudClient $nc;
	private string $root;
	private int $projectId;

	protected function setUp(): void {
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		$this->root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($this->root);
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
	}

	/** @return list<array<string, mixed>> the Assets of the Project, as the app page sees them */
	private function assets(): array {
		$shown = $this->nc->ocs('GET', "/projects/{$this->projectId}");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return $shown['data']['assets'];
	}

	/** @return list<array<string, mixed>> the Version Stack of the one Asset with this name */
	private function stack(string $name): array {
		$matching = array_values(array_filter($this->assets(), static fn (array $asset) => $asset['name'] === $name));
		self::assertCount(1, $matching, "expected exactly one Asset named $name");
		return $matching[0]['versions'];
	}

	private function put(string $name): void {
		$this->nc->put("{$this->root}/$name", 'not really a video');
	}

	public function testAStackHoldsOneKindOfMedia(): void {
		$this->put('cut.mp4');
		$this->put('cut_v2.mp3');
		$this->put('cut_v3.mov');
		$byCount = [];
		foreach ($this->assets() as $asset) {
			$byCount[count($asset['versions'])] = $asset;
		}
		self::assertSame(['cut_v3.mov', 'cut.mp4'], array_column($byCount[2]['versions'] ?? [], 'name'), 'the next cut stacks on the first, whatever its container');
		self::assertSame(['cut_v2.mp3'], array_column($byCount[1]['versions'] ?? [], 'name'), 'the mp3 of the same name stays an Asset of its own');

		$refused = $this->nc->ocs('POST', "/versions/{$byCount[1]['versions'][0]['id']}/stack", ['assetId' => $byCount[2]['id']]);
		self::assertSame(400, $refused['status'], 'audio never joins a video\'s Version Stack');
	}

	public function testTheFilenameConventionStacksAndTheMemberCanUndoIt(): void {
		$this->put('cut_v1.mp4');
		$this->put('cut_v2.mp4');

		$stack = $this->stack('cut');
		self::assertSame([2, 1], array_column($stack, 'number'), 'both files are one Asset, newest Version on top');
		self::assertTrue($stack[0]['autoStacked'], 'the automatic stack is marked, so it can be undone');
		self::assertFalse($stack[1]['autoStacked']);

		$undone = $this->nc->ocs('POST', "/versions/{$stack[0]['id']}/unstack");
		self::assertSame(200, $undone['status'], json_encode($undone['data']));
		self::assertFalse($undone['data']['autoStacked']);
		$assets = $this->assets();
		self::assertCount(2, $assets, 'the undo leaves two Assets again');
		self::assertSame(['cut', 'cut'], array_column($assets, 'name'), 'both go by the name the convention gave them');

		// Taking note of an automatic stack clears the undo mark
		$stacked = $undone['data'];
		$acknowledged = $this->nc->ocs('PUT', "/versions/{$stack[1]['id']}", ['autoStacked' => false]);
		self::assertSame(200, $acknowledged['status'], json_encode($acknowledged['data']));
		self::assertFalse($acknowledged['data']['autoStacked']);
		self::assertNotEmpty($stacked['id']);
	}

	public function testAnAmbiguousNameIsLeftAlone(): void {
		// Two Assets in the same folder go by the name "cut"
		$this->put('cut.mp4');
		$this->put('cut.mov');
		self::assertCount(2, $this->assets(), 'two Assets, not one Stack');

		$this->put('cut_v2.mp4');
		$assets = $this->assets();
		self::assertCount(3, $assets, 'the third file stays on its own instead of guessing');
		foreach ($assets as $asset) {
			self::assertCount(1, $asset['versions']);
			self::assertFalse($asset['versions'][0]['autoStacked']);
		}
	}

	public function testStackingAndUnstackingByHand(): void {
		$this->put('cut.mp4');
		$this->put('teaser.mp4');
		$byName = array_column($this->assets(), null, 'name');
		$cut = $byName['cut'];
		$teaserVersion = $byName['teaser']['versions'][0]['id'];

		$stacked = $this->nc->ocs('POST', "/versions/$teaserVersion/stack", ['assetId' => $cut['id'], 'number' => 5]);
		self::assertSame(200, $stacked['status'], json_encode($stacked['data']));
		self::assertSame(5, $stacked['data']['number']);

		$assets = $this->assets();
		self::assertCount(1, $assets, 'the Asset it left behind is gone with it');
		self::assertSame('teaser', $assets[0]['name'], 'an Asset goes by its newest Version');
		self::assertSame([5, 1], array_column($assets[0]['versions'], 'number'));

		self::assertSame(409, $this->nc->ocs('PUT', "/versions/$teaserVersion", ['number' => 1])['status'], 'a Version Number is unique in its Stack');
		self::assertSame(200, $this->nc->ocs('PUT', "/versions/$teaserVersion", ['number' => 2])['status']);

		$unstacked = $this->nc->ocs('POST', "/versions/$teaserVersion/unstack");
		self::assertSame(200, $unstacked['status'], json_encode($unstacked['data']));
		self::assertCount(2, $this->assets(), 'two Assets again');
	}

	public function testTrashKeepsTheCommentsAndPermanentDeletionDoesNot(): void {
		$this->put('cut.mp4');
		$versionId = $this->stack('cut')[0]['id'];
		$comment = $this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => 12, 'body' => 'still here?']);
		self::assertSame(201, $comment['status'], json_encode($comment['data']));

		$this->nc->delete("{$this->root}/cut.mp4");
		self::assertSame('missing', $this->stack('cut')[0]['state'], 'in the trash the file is Missing, not gone');
		self::assertCount(1, $this->nc->ocs('GET', "/versions/$versionId/comments")['data']['comments'], 'its Comments wait for it');

		$this->nc->emptyTrash();
		self::assertSame([], $this->assets(), 'permanently deleted takes the Version with it');
		self::assertSame(404, $this->nc->ocs('GET', "/versions/$versionId/comments")['status'], 'and its Comments');
	}

	public function testRenamingInsideTheProjectKeepsTheVersion(): void {
		$this->put('cut.mp4');
		$before = $this->stack('cut')[0];
		$comment = $this->nc->ocs('POST', "/versions/{$before['id']}/comments", ['inFrame' => 3, 'body' => 'keep me']);
		self::assertSame(201, $comment['status']);

		$this->nc->move("{$this->root}/cut.mp4", "{$this->root}/final cut v2.mp4");

		$stack = $this->stack('final cut');
		self::assertSame($before['id'], $stack[0]['id'], 'the name follows the file, but it is the same Version');
		self::assertSame('ready', $stack[0]['state']);
		self::assertCount(1, $this->nc->ocs('GET', "/versions/{$before['id']}/comments")['data']['comments']);
	}
}
