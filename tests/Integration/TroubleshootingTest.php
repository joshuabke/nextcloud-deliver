<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * What an admin of a hosted Nextcloud, without a shell, has to go on: setup
 * checks on the overview, failed media jobs to retry, and a support report.
 */
class TroubleshootingTest extends TestCase {
	private NextcloudClient $nc;

	protected function setUp(): void {
		$this->nc = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
	}

	public function testTheSupportReportTellsVersionsQueueAndCountsButNoNames(): void {
		$root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($root);
		$this->nc->put("$root/secret-client-cut.mp4", 'not really a video');
		$project = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($root)])['data']['id'];

		$report = $this->nc->ocs('GET', '/admin/report');
		self::assertSame(200, $report['status'], json_encode($report['data']));
		self::assertMatchesRegularExpression('/^\d+\.\d+\.\d+/', $report['data']['deliver']);
		self::assertContains($report['data']['backgroundJobs']['mode'], ['ajax', 'webcron', 'cron']);
		self::assertGreaterThan(0, $report['data']['counts']['versions']);
		self::assertStringNotContainsString('secret-client', json_encode($report['data']), 'no file or Project names');

		$this->nc->ocs('DELETE', "/projects/$project");
		$this->nc->delete($root);
	}

	public function testFailedJobsShowOnTheOverviewAndGoBackIntoTheQueue(): void {
		$root = 'deliver-test-' . bin2hex(random_bytes(4));
		$this->nc->mkdir($root);
		$this->nc->put("$root/cut.mp4", 'not really a video');
		$project = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId($root)])['data']['id'];
		exec('php /var/www/html/occ deliver:worker --once 2>&1');

		$failed = fn () => $this->nc->ocs('GET', '/admin/settings')['data']['status']['states']['failed'] ?? 0;
		self::assertGreaterThan(0, $failed(), 'a file ffprobe cannot read fails its probe');
		exec('php /var/www/html/occ setupchecks --output=json', $output);
		$check = json_decode(implode('', $output), true)['system']['OCA\\Deliver\\SetupCheck\\MediaJobsCheck'];
		self::assertSame('warning', $check['severity']);
		self::assertStringContainsString('/settings/admin/deliver', $check['linkToDoc']);

		$retried = $this->nc->ocs('POST', '/admin/jobs/retry');
		self::assertSame(200, $retried['status'], json_encode($retried['data']));
		self::assertGreaterThan(0, $retried['data']['retried']);
		self::assertSame(0, $retried['data']['status']['states']['failed'] ?? 0, 'all of them are queued again');

		$this->nc->ocs('DELETE', "/projects/$project");
		$this->nc->delete($root);
	}
}
