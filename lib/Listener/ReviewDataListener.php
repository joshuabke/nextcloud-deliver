<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\Db\VersionMapper;
use OCA\Deliver\Event\ReviewDataChanged;
use OCA\Deliver\Service\FileLock;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * Locks the file of a Version when its first Comment or Approval comes and
 * lifts the lock when its last one goes (ADR 0018).
 *
 * @template-implements IEventListener<ReviewDataChanged>
 */
class ReviewDataListener implements IEventListener {
	public function __construct(
		private VersionMapper $versions,
		private FileLock $fileLock,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof ReviewDataChanged && ($version = $this->versions->find($event->versionId)) !== null) {
			$this->fileLock->sync($version);
		}
	}
}
