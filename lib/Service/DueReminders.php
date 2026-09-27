<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Utility\ITimeFactory;

/**
 * Reminds Members of Due Dates the day before and on the day (story 93),
 * each once. An Asset whose newest Version is approved, with nobody asking
 * for changes, needs no reminder.
 */
class DueReminders {
	public function __construct(
		private AssetMapper $assets,
		private VersionMapper $versions,
		private ApprovalMapper $approvals,
		private NotificationService $notifications,
		private ITimeFactory $time,
	) {
	}

	/** @return int how many reminders went out */
	public function send(): int {
		$today = $this->time->getDateTime()->format('Y-m-d');
		$tomorrow = $this->time->getDateTime('tomorrow')->format('Y-m-d');
		$sent = 0;
		foreach ($this->assets->findDueOn([$today, $tomorrow]) as $asset) {
			$isToday = $asset->getDueDate() === $today;
			$key = $asset->getDueDate() . ':' . ($isToday ? 'today' : 'tomorrow');
			$stack = $this->versions->findByAsset($asset->getId());
			$newest = end($stack);
			if ($asset->getDueReminded() === $key || $newest === false || $this->approved($newest->getId())) {
				continue;
			}
			$this->notifications->due($newest, $isToday);
			$asset->setDueReminded($key);
			$this->assets->update($asset);
			$sent++;
		}
		return $sent;
	}

	private function approved(int $versionId): bool {
		$counts = $this->approvals->countByVersions([$versionId])[$versionId] ?? ['approved' => 0, 'changes' => 0];
		return $counts['approved'] > 0 && $counts['changes'] === 0;
	}
}
