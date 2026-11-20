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
	/** A job a request claimed has lost its request after this long: the probe gives up after two minutes, a Waveform in a request after seconds */
	private const REQUEST_STALE_AFTER = 5 * 60;

	/** Until when no Waveform is made while idle: one that failed may have failed for a cause no Version has (storage offline), which would fail them all */
	private int $idlePausedUntil = 0;
	/** How long that lasts in a worker; a cron run ends long before */
	private const IDLE_PAUSE = 3600;

	/** Until when no Waveform is made while idle: one that failed may have failed for a cause no Version has (storage offline), which would fail them all */
	private int $idlePausedUntil = 0;
	/** How long that lasts in a worker; a cron run ends long before */
	private const IDLE_PAUSE = 3600;

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
		$this->jobs->requeueStaleRequests($now - self::REQUEST_STALE_AFTER);
		// ponytail: count, then claim; two workers can overshoot the cap by one at the same instant
		$cap = max(1, $this->config->getValueInt(Application::APP_ID, 'max_jobs', 1));
		$running = $this->jobs->countRunningOnServer();
		// Scrub Proxies hold up no other work: what they keep busy, the rest may go past (#169)
		$others = $this->jobs->countRunningOnServer(Job::KIND_SCRUB);
		if ($others >= $cap) {
			return false;
		}
		foreach ($this->jobs->findQueued(10) as $job) {
			if ($job->getKind() === Job::KIND_SCRUB && $running >= $cap) {
				return false;
			}
			if ($this->jobs->claim($job, $worker, $now)) {
				$this->media->process($job);
				return true;
			}
		}
		// Nothing else to do: a Waveform a Version lacks, such as one from before the fixed rate (ADR 0021)
		$job = $now < $this->idlePausedUntil ? null : $this->media->queueMissingWaveform();
		if ($job !== null && $this->jobs->claim($job, $worker, $now)) {
			$this->media->process($job);
			if ($this->jobs->find($job->getId())?->getState() === Job::STATE_FAILED) {
				$this->idlePausedUntil = $now + self::IDLE_PAUSE;
			}
			return true;
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
