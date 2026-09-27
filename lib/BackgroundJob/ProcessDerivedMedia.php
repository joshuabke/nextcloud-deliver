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
		$this->setInterval(5 * 60);
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$this->runner->drain('cron', self::BUDGET);
	}
}
