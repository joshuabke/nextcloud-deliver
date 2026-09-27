<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/** Stills are Assets too (story 95): one Frame, their size, no derived media */
class StillTest extends TestCase {
	/** A 3 × 2 PNG */
	private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAADwyuo0AAAAEklEQVR4nGP4z8DAwMDAxMAAAAoKAQNRZjD2AAAAAElFTkSuQmCC';

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
	}

	public function testAPictureInTheFolderBecomesAStillAsset(): void {
		$this->nc->put("{$this->root}/poster.png", base64_decode(self::PNG));
		$this->nc->put("{$this->root}/notes.txt", 'not reviewed');
		$assets = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		self::assertSame(['poster'], array_column($assets, 'name'), 'pictures join through Auto Intake, text does not');
		$versionId = $assets[0]['versions'][0]['id'];

		exec('php /var/www/html/occ deliver:worker --once 2>&1');
		$version = $this->nc->ocs('GET', "/versions/$versionId")['data']['versions'][0];
		self::assertSame([3, 2, true, 'image/png'], [$version['width'], $version['height'], $version['playable'], $version['mimeType']]);
		self::assertSame('none', $version['derived']['proxy']['state'], 'nothing to transcode');
		self::assertFalse($version['audioOnly'], 'a picture is no sound');

		$comment = $this->nc->ocs('POST', "/versions/$versionId/comments", ['inFrame' => 0, 'body' => 'warmer sky', 'annotation' => [['tool' => 'box', 'color' => '#ff0000', 'points' => [[0.1, 0.1], [0.5, 0.5]]]]]);
		self::assertSame(201, $comment['status'], json_encode($comment['data']));
	}
}
