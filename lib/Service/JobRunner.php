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
		// Scrub Proxies and loudness hold up no other work: what they keep busy, the rest may go past (#169, A5)
		$others = $this->jobs->countRunningOnServer(Job::BACKGROUND_KINDS);
		if ($others >= $cap) {
			return false;
		}
		foreach ($this->jobs->findQueued(10) as $job) {
			if (in_array($job->getKind(), Job::BACKGROUND_KINDS, true) && $running >= $cap) {
				return false;
			}
			// The loudness waits for the Waveforms the queue makes while idle (A5)
			if ($job->getKind() === Job::KIND_LOUDNESS && $this->idleWaveform($worker, $now)) {
				return true;
			}
			if ($this->jobs->claim($job, $worker, $now)) {
				$this->media->process($job);
				return true;
			}
		}
		return $this->idleWaveform($worker, $now);
	}

	/** Nothing else to do: a Waveform a Version lacks, such as one from before the fixed rate (ADR 0021) */
	private function idleWaveform(string $worker, int $now): bool {
		$job = $this->media->queueMissingWaveform();
		if ($job === null || !$this->jobs->claim($job, $worker, $now)) {
			return false;
		}
		$this->media->process($job, idle: true);
		if ($this->jobs->find($job->getId())?->getState() === Job::STATE_FAILED) {
			$this->media->pauseIdleWaveforms();
		}
		return true;
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
