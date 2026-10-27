<?php

declare(strict_types=1);

namespace OCA\Deliver\BackgroundJob;

use OCA\Deliver\Service\ProjectService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/**
 * The periodic scan next to the file listener (spec: Discovery and stacking).
 * It catches what fires no event Deliver can hear, like deletions from the
 * trash, and turns a Folder Project whose folder is gone for good into a
 * plain Project.
 */
class ScanProjects extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private ProjectService $projects,
	) {
		parent::__construct($time);
		$this->setInterval(3600);
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$this->projects->scanAll();
	}
}
