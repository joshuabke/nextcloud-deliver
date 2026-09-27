<?php

declare(strict_types=1);

namespace OCA\Deliver\BackgroundJob;

use OCA\Deliver\Service\DueReminders;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/** Looks every hour whether a Due Date needs a reminder; each goes out once (story 93) */
class RemindDueDates extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private DueReminders $reminders,
	) {
		parent::__construct($time);
		$this->setInterval(3600);
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$this->reminders->send();
	}
}
