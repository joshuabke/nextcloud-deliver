<?php

declare(strict_types=1);

namespace OCA\Deliver\BackgroundJob;

use OCA\Deliver\Service\DerivedMedia;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use Psr\Log\LoggerInterface;

/**
 * Looks, some time after the probe of a Version, whether a browser still has
 * to make its Proxy and tells the Managers then (ADR 0019); again later while
 * a browser is at it. One at most waits per Version: the argument is its id.
 */
class AskBrowserPass extends QueuedJob {
	public function __construct(
		ITimeFactory $time,
		private DerivedMedia $media,
		private IJobList $jobList,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	protected function run($argument): void {
		$versionId = (int)$argument;
		try {
			$later = $this->media->askBrowserPass($versionId);
		} catch (\Throwable $e) {
			// A storage or database away for a moment: nobody else would ask
			$this->logger->warning('Deliver could not ask for the Proxy of Version {version}', ['version' => $versionId, 'exception' => $e]);
			$later = DerivedMedia::ASK_LATER;
		}
		if ($later !== null) {
			$this->jobList->scheduleAfter(self::class, $this->time->getTime() + $later, $versionId);
		}
	}
}
