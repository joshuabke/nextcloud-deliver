<?php

declare(strict_types=1);

namespace OCA\Deliver\BackgroundJob;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\VersionMapper;
use OCA\Deliver\Service\ApprovalService;
use OCA\Deliver\Service\NotificationService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\IConfig;

/**
 * Looks every hour whether a Due Date needs a reminder, the day before and on
 * the day, each once (story 93). An Asset whose newest Version is approved,
 * with nobody asking for changes, needs no reminder.
 */
class RemindDueDates extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private ApprovalMapper $approvals,
		private NotificationService $notifications,
		private IConfig $config,
	) {
		parent::__construct($time);
		$this->setInterval(3600);
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		// ponytail: days in the instance's default time zone; per-Member zones would need a reminder per person
		$zone = new \DateTimeZone($this->config->getSystemValueString('default_timezone', 'UTC') ?: 'UTC');
		$today = $this->time->getDateTime('now', $zone)->format('Y-m-d');
		$tomorrow = $this->time->getDateTime('tomorrow', $zone)->format('Y-m-d');
		foreach ($this->assets->findDueOn([$today, $tomorrow]) as $asset) {
			$isToday = $asset->getDueDate() === $today;
			$key = $asset->getDueDate() . ':' . ($isToday ? 'today' : 'tomorrow');
			$newest = $this->versions->findNewest($asset->getId());
			if ($asset->getDueReminded() === $key || $newest === null
				|| ApprovalService::isApproved($this->approvals->countByVersions([$newest->getId()])[$newest->getId()])) {
				continue;
			}
			$this->notifications->due($newest, $isToday);
			$asset->setDueReminded($key);
			$this->assets->update($asset);
		}
	}
}
