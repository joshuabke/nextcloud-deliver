<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Job;
use OCA\Deliver\Db\JobMapper;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IDBConnection;

/**
 * What an admin hands over when Deliver misbehaves: versions, the media
 * pipeline, the queue with its latest failures, and how much there is. No
 * names, comments or Reviewers; the failures' ffmpeg output can carry file
 * paths, which the admin panel says before it is shared.
 */
class SupportReport {
	private const TABLES = ['projects', 'assets', 'versions', 'comments', 'reviewers', 'project_links', 'jobs'];

	public function __construct(
		private PipelineSettings $settings,
		private JobMapper $jobs,
		private IAppManager $apps,
		private IAppConfig $appConfig,
		private IConfig $config,
		private IDBConnection $db,
		private IRootFolder $root,
		private ITimeFactory $time,
	) {
	}

	/** @return array<string, mixed> */
	public function build(): array {
		$now = $this->time->getTime();
		$lastCron = $this->appConfig->getValueInt('core', 'lastcron');
		return [
			'generated' => gmdate('c', $now),
			'deliver' => $this->apps->getAppVersion(Application::APP_ID),
			'nextcloud' => $this->config->getSystemValueString('version'),
			'php' => PHP_VERSION,
			'database' => $this->db->getDatabaseProvider(),
			'os' => PHP_OS_FAMILY,
			'backgroundJobs' => [
				'mode' => self::backgroundMode($this->appConfig),
				'lastRunSecondsAgo' => $lastCron === 0 ? null : $now - $lastCron,
			],
			'mail' => ReviewerMail::configured($this->config),
			'liveUpdates' => $this->apps->isEnabledForAnyone('notify_push'),
			'pipeline' => $this->settings->status() + ['settings' => $this->settings->get()],
			'failedJobs' => array_map(static fn (Job $job) => [
				'kind' => $job->getKind(),
				'versionId' => $job->getVersionId(),
				'attempts' => $job->getAttempts(),
				'failedAt' => $job->getFinishedAt() === null ? null : gmdate('c', $job->getFinishedAt()),
				'error' => $job->getStderrTail(),
			], $this->jobs->findFailed(10)),
			'counts' => array_combine(self::TABLES, array_map(fn (string $table) => $this->count($table), self::TABLES)),
			'derivedMediaBytes' => $this->derivedMediaBytes(),
		];
	}

	/** Nextcloud runs background jobs on page loads unless an admin chose otherwise */
	public static function backgroundMode(IAppConfig $appConfig): string {
		return $appConfig->getValueString('core', 'backgroundjobs_mode', 'ajax');
	}

	private function count(string $table): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'amount'))->from('deliver_' . $table);
		$result = $qb->executeQuery();
		$amount = (int)$result->fetchOne();
		$result->closeCursor();
		return $amount;
	}

	/** Proxies, Thumbnail Strips and Waveforms in app data, as Files' cache knows them */
	private function derivedMediaBytes(): ?int {
		try {
			return (int)$this->root->get('appdata_' . $this->config->getSystemValueString('instanceid') . '/' . Application::APP_ID)->getSize();
		} catch (NotFoundException) {
			return null;
		}
	}
}
