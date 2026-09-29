<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Job;
use OCA\Deliver\Db\JobMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;

/**
 * Works through the derived-media queue. Cron and `occ deliver:worker` run the
 * same code on the same table (ADR 0003); the admin setting caps how many
 * jobs run at once across all of them.
 */
class JobRunner {
	/** A job running this long has lost its worker; ffmpeg itself gives up after an hour */
	private const STALE_AFTER = 2 * 3600;

	public function __construct(
		private JobMapper $jobs,
		private DerivedMedia $media,
		private IAppConfig $config,
		private ITimeFactory $time,
	) {
	}

	/** @return bool whether a job ran; false when the queue is empty or the cap is reached */
	public function runNext(string $worker): bool {
		$now = $this->time->getTime();
		$this->jobs->requeueStale($now - self::STALE_AFTER);
		// ponytail: count, then claim; two workers can overshoot the cap by one at the same instant
		if (($this->jobs->countByState()[Job::STATE_RUNNING] ?? 0) >= max(1, $this->config->getValueInt(Application::APP_ID, 'max_jobs', 1))) {
			return false;
		}
		foreach ($this->jobs->findQueued(10) as $job) {
			if ($this->jobs->claim($job, $worker, $now)) {
				$this->media->process($job);
				return true;
			}
		}
		return false;
	}

	/** @return int how many jobs ran before the queue ran dry or the time was up */
	public function drain(string $worker, int $seconds): int {
		$deadline = $this->time->getTime() + $seconds;
		$ran = 0;
		while ($this->time->getTime() < $deadline && $this->runNext($worker)) {
			$ran++;
		}
		return $ran;
	}
}
