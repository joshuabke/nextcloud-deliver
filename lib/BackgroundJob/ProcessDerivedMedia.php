<?php

declare(strict_types=1);

namespace OCA\Deliver\BackgroundJob;

use OCA\Deliver\Service\JobRunner;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/** Cron's turn at the derived-media queue; `occ deliver:worker` does the same without waiting */
class ProcessDerivedMedia extends TimedJob {
	/** How long one cron run keeps starting new jobs */
	private const BUDGET = 4 * 60;

	public function __construct(
		ITimeFactory $time,
		private JobRunner $runner,
	) {
		parent::__construct($time);
		// Every cron run: at its own five minutes it missed every other run of a cron every five minutes, as it starts a few seconds into one
		$this->setInterval(60);
	}

	protected function run($argument): void {
		$this->runner->drain('cron', self::BUDGET);
	}
}
