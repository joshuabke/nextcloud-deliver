<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Captions of a Version (#54): uploaded next to its file by a Member with
 * Manage, stored per language in app data as UTF-8, kept through
 * regeneration and a rewrite of the file, and gone with the Version; Members
 * and Reviewers read them.
 */
class CaptionsTest extends TestCase {
	private const SRT = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n";

	private NextcloudClient $nc;
	private string $root;
	private int $projectId;
	private int $versionId;

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
		$this->nc->put("{$this->root}/cut_v3.mp4", 'not really a video');
		$this->versionId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['versions'][0]['id'];
	}

	protected function tearDown(): void {
		$this->nc->deleteProject($this->projectId);
		$this->nc->delete($this->root);
		$this->nc->emptyTrash();
	}

	/** @return array{0: int, 1: string} the file id and path of a hidden upload next to the Version's file */
	private function upload(string $content): array {
		$path = "{$this->root}/.deliver-captions-" . bin2hex(random_bytes(4));
		$this->nc->put($path, $content);
		return [$this->nc->fileId($path), $path];
	}

	/** @return array{status: int, data: mixed} */
	private function give(string $content, string $language, ?NextcloudClient $as = null): array {
		return ($as ?? $this->nc)->ocs('POST', "/versions/{$this->versionId}/captions", ['fileId' => $this->upload($content)[0], 'language' => $language]);
	}

	/** @return array<string, string> the Version's Captions, URL by language, as the Review view has them */
	private function captions(): array {
		$shown = $this->nc->ocs('GET', "/versions/{$this->versionId}");
		self::assertSame(200, $shown['status'], json_encode($shown['data']));
		return array_column($shown['data']['versions'][0]['captions'], 'url', 'language');
	}

	public function testAMemberWithManageAddsCaptionsPerLanguage(): void {
		[$fileId, $path] = $this->upload(self::SRT);
		$given = $this->nc->ocs('POST', "/versions/{$this->versionId}/captions", ['fileId' => $fileId, 'language' => 'de']);
		self::assertSame(200, $given['status'], json_encode($given['data']));
		self::assertSame(['de'], array_column($given['data']['captions'], 'language'));
		self::assertSame(404, $this->nc->davStatus('GET', $path), 'the upload is gone once taken');

		// A WebVTT with a byte order mark, in a second language
		self::assertSame(200, $this->give("\xEF\xBB\xBFWEBVTT\n\n00:01.000 --> 00:02.000\nHi\n", 'pt-BR')['status']);
		$urls = $this->captions();
		self::assertSame(['de', 'pt-BR'], array_keys($urls));
		self::assertSame(self::SRT, $this->nc->request('GET', $urls['de'])['body']);
		self::assertSame("WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n", $this->nc->request('GET', $urls['pt-BR'])['body'], 'stored without the byte order mark');

		// The same language again replaces the file, even in the other format
		self::assertSame(200, $this->give("WEBVTT\n\n00:05.000 --> 00:06.000\nNeu\n", 'de')['status']);
		$urls = $this->captions();
		self::assertSame(['de', 'pt-BR'], array_keys($urls));
		self::assertStringContainsString('Neu', $this->nc->request('GET', $urls['de'])['body']);

		$removed = $this->nc->ocs('DELETE', "/versions/{$this->versionId}/captions/de");
		self::assertSame(200, $removed['status'], json_encode($removed['data']));
		self::assertSame(['pt-BR'], array_column($removed['data']['captions'], 'language'));
		self::assertSame(404, $this->nc->request('GET', $urls['de'])['status']);
	}

	public function testAFileInWindows1252IsStoredAsUtf8(): void {
		self::assertSame(200, $this->give("1\n00:00:01,000 --> 00:00:02,000\nGr\xFC\xDFe\n", 'de')['status']);
		self::assertSame("1\n00:00:01,000 --> 00:00:02,000\nGrüße\n", $this->nc->request('GET', $this->captions()['de'])['body']);
	}

	public function testAFileWithoutACueOrTooLargeIsRefusedAndItsUploadDeleted(): void {
		[$fileId, $path] = $this->upload("just some text\nwithout any timing\n");
		$refused = $this->nc->ocs('POST', "/versions/{$this->versionId}/captions", ['fileId' => $fileId, 'language' => 'en']);
		self::assertSame(400, $refused['status']);
		self::assertStringContainsString('cue', $refused['data']['message']);
		self::assertSame(404, $this->nc->davStatus('GET', $path), 'refused, the upload is gone too');

		self::assertSame(400, $this->give(str_repeat(self::SRT, intdiv(1024 * 1024, strlen(self::SRT)) + 1), 'en')['status'], 'above 1 MB');
		self::assertSame(400, $this->give(self::SRT, 'not a language')['status']);
		self::assertSame([], $this->captions());
	}

	public function testCaptionsOutliveRegenerationAndARewriteOfTheFile(): void {
		self::assertSame(200, $this->give(self::SRT, 'en')['status']);
		self::assertSame(200, $this->nc->ocs('POST', "/versions/{$this->versionId}/regenerate")['status']);
		self::assertSame(['en'], array_keys($this->captions()), 'regenerating deletes only derived media');

		$this->nc->put("{$this->root}/cut_v3.mp4", 'another cut, written again');
		self::assertSame(['en'], array_keys($this->captions()), 'a rewrite reads the file again, the Captions stay');
	}

	public function testCaptionsGoWithTheVersion(): void {
		self::assertSame(200, $this->give(self::SRT, 'en')['status']);
		$assetId = $this->nc->ocs('GET', "/projects/{$this->projectId}")['data']['assets'][0]['id'];
		self::assertSame(200, $this->nc->ocs('DELETE', "/assets/$assetId")['status']);
		exec('php -r ' . escapeshellarg('require "/var/www/html/lib/base.php"; try { \OCP\Server::get(\OCP\Files\AppData\IAppDataFactory::class)->get("deliver")->getFolder("captions-' . $this->versionId . '"); echo "kept"; } catch (\OCP\Files\NotFoundException) { echo "gone"; }') . ' 2>&1', $output);
		self::assertSame('gone', end($output));
	}

	public function testOnlyManageChangesCaptionsWhileEveryoneWhoSeesTheVersionReadsThem(): void {
		self::assertSame(200, $this->give(self::SRT, 'en')['status']);
		$user = 'deliver-viewer-' . bin2hex(random_bytes(3));
		$this->nc->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $user, 'password' => 'Viewer-pass-123!']);
		try {
			$share = $this->nc->ocsForm('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', ['path' => $this->root, 'shareType' => 0, 'shareWith' => $user, 'permissions' => 1]);
			self::assertSame(200, $share['status'], json_encode($share['data']));
			$viewer = $this->nc->withUser($user, 'Viewer-pass-123!');
			self::assertSame(403, $viewer->ocs('POST', "/versions/{$this->versionId}/captions", ['fileId' => $this->upload(self::SRT)[0], 'language' => 'de'])['status']);
			self::assertSame(403, $viewer->ocs('DELETE', "/versions/{$this->versionId}/captions/en")['status']);
			self::assertSame(self::SRT, $viewer->request('GET', $this->captions()['en'])['body']);
		} finally {
			$this->nc->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$user");
		}

		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$reviewer = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$context = $reviewer->call('GET', "/api/context?versionId={$this->versionId}");
		self::assertSame(200, $context['status'], json_encode($context['data']));
		$url = $context['data']['versions'][0]['captions'][0]['url'];
		self::assertSame(self::SRT, $reviewer->raw(substr($url, strpos($url, $link['token']) + strlen($link['token'])))['body']);
	}
}
