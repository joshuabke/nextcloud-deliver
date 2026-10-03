<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Project Links (ADR 0010): a review link of Deliver's own for a whole
 * Project or the Assets a Member picks, on the same review page and API as a
 * Share Link, with password, expiry, pause, rights and activity of its own.
 */
class ProjectLinkTest extends TestCase {
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
		$this->nc->put("{$this->root}/cut.mp4", 'not really a video');
		$this->nc->put("{$this->root}/teaser.mp4", 'not really a video');
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($this->root)]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
	}

	protected function tearDown(): void {
		$this->nc->ocs('DELETE', "/projects/{$this->projectId}");
		$this->nc->delete($this->root);
	}

	/** @return array<string, mixed> the new Project Link */
	private function link(): array {
		$created = $this->nc->ocs('POST', "/projects/{$this->projectId}/links");
		self::assertSame(201, $created['status'], json_encode($created['data']));
		return $created['data'];
	}

	/** @return array<string, mixed> the Project Link as changed */
	private function change(int $id, array $fields, int $status = 200): array {
		$changed = $this->nc->ocs('PUT', "/links/$id", $fields);
		self::assertSame($status, $changed['status'], json_encode($changed['data']));
		return $changed['data'];
	}

	private function visitor(array $link): PublicClient {
		return new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
	}

	/** @return array<string, int> Asset name → newest Version id */
	private function assets(): array {
		$assets = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		return array_combine(array_column($assets, 'name'), array_map(static fn (array $asset) => $asset['versions'][0]['id'], $assets));
	}

	public function testALinkShowsTheWholeProjectAsItGrows(): void {
		$link = $this->link();
		self::assertTrue($link['review'], 'a new link is live');
		self::assertNull($link['assetIds'], 'the whole Project unless Assets are picked');
		self::assertStringContainsString('/apps/deliver/s/' . $link['token'], $link['url']);

		$visitor = $this->visitor($link);
		self::assertSame(200, $visitor->raw('')['status']);
		self::assertCount(2, $visitor->call('GET', '/api/assets')['data']);

		$this->nc->put("{$this->root}/trailer.mp4", 'not really a video');
		$this->nc->ocs('GET', "/projects/{$this->projectId}");
		self::assertCount(3, $visitor->call('GET', '/api/assets')['data'], 'a new Asset of the Project shows up by itself');

		$listed = $this->nc->ocs('GET', "/projects/{$this->projectId}/shares")['data'];
		self::assertSame([$link['id']], array_column($listed['projectLinks'], 'id'), 'the navigation lists it');
	}

	public function testPickedAssetsLimitTheLink(): void {
		$link = $this->link();
		$assets = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'];
		$cut = array_column($assets, null, 'name')['cut'];
		$teaser = array_column($assets, null, 'name')['teaser'];
		self::assertSame([$cut['id']], $this->change($link['id'], ['assetIds' => [$cut['id']]])['assetIds']);

		$visitor = $this->visitor($link);
		self::assertSame([$cut['id']], array_column($visitor->call('GET', '/api/assets')['data'], 'assetId'));
		self::assertSame(404, $visitor->call('GET', '/api/context?versionId=' . $teaser['versions'][0]['id'])['status'], 'what is not picked stays closed');

		self::assertNull($this->change($link['id'], ['assetIds' => null])['assetIds']);
		self::assertCount(2, $visitor->call('GET', '/api/assets')['data'], 'back to the whole Project');

		$this->change($link['id'], ['assetIds' => [$cut['id']]]);
		self::assertNull($this->change($link['id'], ['assetIds' => []])['assetIds'], 'unpicking the last Asset is the whole Project again');
		self::assertCount(2, $visitor->call('GET', '/api/assets')['data']);
	}

	public function testPasswordExpiryAndPause(): void {
		$link = $this->link();
		$visitor = $this->visitor($link);
		$versionId = $this->assets()['cut'];

		$protected = $this->change($link['id'], ['password' => 'Review-' . bin2hex(random_bytes(6)), 'expireDate' => '2099-12-31']);
		self::assertSame([true, '2099-12-31'], [$protected['hasPassword'], $protected['expireDate']]);
		self::assertSame(303, $visitor->raw('')['status'], 'core asks for the password');
		self::assertSame(404, $visitor->call('GET', "/api/context?versionId=$versionId")['status'], 'the API answers nothing until the password is given');

		$this->change($link['id'], ['password' => '', 'expireDate' => '']);
		self::assertSame(200, $visitor->raw('')['status']);
		$this->change($link['id'], ['expireDate' => '2001-01-01'], 400);

		self::assertFalse($this->change($link['id'], ['review' => false])['review']);
		self::assertSame(404, $visitor->raw('')['status'], 'a paused link shows nothing');
		$this->change($link['id'], ['review' => true]);
		self::assertSame(200, $visitor->raw('')['status'], 'and comes back as it was');

		self::assertSame(200, $this->nc->ocs('DELETE', "/links/{$link['id']}")['status']);
		self::assertSame(404, $visitor->raw('')['status']);
	}

	public function testOnlyTheNewestVersionAndTheDescription(): void {
		$this->nc->put("{$this->root}/cut_v2.mp4", 'the second cut');
		$stack = array_column($this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'], 'versions', 'name')['cut'];
		self::assertCount(2, $stack, 'the new file stacks on the old one');
		$link = $this->link();
		$visitor = $this->visitor($link);
		self::assertCount(2, $visitor->call('GET', "/api/context?versionId={$stack[0]['id']}")['data']['versions']);

		$changed = $this->change($link['id'], ['latestOnly' => true, 'description' => 'Rough cut for Acme', 'canDownload' => false]);
		self::assertSame([true, 'Rough cut for Acme', false], [$changed['latestOnly'], $changed['description'], $changed['canDownload']]);
		$context = $visitor->call('GET', "/api/context?versionId={$stack[0]['id']}")['data'];
		self::assertSame([$stack[0]['id']], array_column($context['versions'], 'id'), 'only the newest Version');
		self::assertSame('Rough cut for Acme', $context['description']);
		self::assertFalse($context['flags']['canDownload']);
		self::assertSame(404, $visitor->call('GET', "/api/context?versionId={$stack[1]['id']}")['status'], 'the older one stays closed');
	}

	public function testReviewersAndActivityFollowTheToken(): void {
		$link = $this->link();
		$versionId = $this->assets()['cut'];
		$invited = $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Kim']);
		self::assertSame(201, $invited['status'], json_encode($invited['data']));
		self::assertStringContainsString($link['token'] . '?r=', $invited['data']['link']);

		$kim = $this->visitor($link);
		self::assertSame(200, $kim->raw('?r=' . $invited['data']['key'])['status']);
		$context = $kim->call('GET', "/api/context?versionId=$versionId");
		self::assertSame(['reviewer', 'Kim'], [$context['data']['me']['type'], $context['data']['me']['name']]);

		$shares = $this->nc->ocs('GET', "/projects/{$this->projectId}/shares")['data'];
		self::assertSame(['Kim'], array_column($shares['reviewers'], 'name'), 'the Project lists who came by its link');
		self::assertSame([$invited['data']['id']], array_column($shares['projectLinks'], 'reviewerIds')[0]);

		$activity = $this->nc->ocs('GET', "/links/{$link['id']}/activity")['data'];
		self::assertSame(['viewed', 'opened'], array_column(array_slice($activity, 0, 2), 'kind'), 'newest first');
		self::assertSame(['Kim', $versionId], [$activity[0]['reviewer']['name'], $activity[0]['versionId']]);

		$this->change($link['id'], ['review' => false]);
		$paused = $this->nc->ocs('GET', "/projects/{$this->projectId}/shares")['data'];
		self::assertSame(['Kim'], array_column($paused['reviewers'], 'name'), 'pausing the link keeps its Reviewers in reach');
		self::assertSame([], $paused['reviewers'][0]['links'], 'but no Personal Link goes through a paused one');
	}

	public function testDownloadAllZipsTheNewestOfEveryAsset(): void {
		$link = $this->link();
		$visitor = $this->visitor($link);
		$listed = $visitor->call('GET', '/api/assets')['data'];
		self::assertCount(2, array_filter(array_column($listed, 'downloadUrl')), 'every Asset downloads on its own');
		self::assertStringContainsString('/media/', $listed[0]['playUrl'], 'a frame of the video stands in for a missing still');

		$zip = $visitor->raw('/download');
		self::assertSame(200, $zip['status']);
		self::assertStringStartsWith('PK', $zip['body']);
		self::assertStringContainsString('cut.mp4', $zip['body']);
		self::assertStringContainsString('teaser.mp4', $zip['body']);
		$kinds = array_count_values(array_column($this->nc->ocs('GET', "/links/{$link['id']}/activity")['data'], 'kind'));
		self::assertSame(2, $kinds['downloaded'] ?? 0, 'each file in it counts as a download');

		$this->change($link['id'], ['canDownload' => false]);
		self::assertSame([null, null], array_column($visitor->call('GET', '/api/assets')['data'], 'downloadUrl'));
		self::assertSame(404, $visitor->raw('/download')['status']);
	}

	public function testALinkShowsOnlyWhatItsMemberMayShare(): void {
		$uid = 'deliver-guest-' . bin2hex(random_bytes(4));
		$password = 'Deliver-' . bin2hex(random_bytes(8));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $uid, 'password' => $password]);
		$guest = $this->nc->withUser($uid, $password);
		try {
			// Read only, no resharing
			$this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => "/{$this->root}/cut.mp4", 'shareType' => 0, 'shareWith' => $uid, 'permissions' => 1]);
			$created = $guest->ocs('POST', "/projects/{$this->projectId}/links");
			self::assertSame(201, $created['status'], json_encode($created['data']));
			$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $created['data']['token']);
			self::assertSame([], $visitor->call('GET', '/api/assets')['data'], 'a file the Member may not reshare stays out');
			self::assertSame(403, $this->nc->ocs('PUT', "/links/{$created['data']['id']}", ['review' => false])['status'], 'only its Member changes a link');
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$uid");
		}
	}

	public function testALinkGoesWithItsProject(): void {
		$link = $this->link();
		self::assertSame(200, $this->nc->ocs('DELETE', "/projects/{$this->projectId}")['status']);
		self::assertSame(404, $this->visitor($link)->raw('')['status']);
	}
}
