<?php

declare(strict_types=1);

namespace OCA\Deliver\Event;

use OCP\EventDispatcher\Event;

/** A Comment or Approval of a Version was written or removed; its file's lock follows (ADR 0018) */
class ReviewDataChanged extends Event {
	public function __construct(
		public readonly int $versionId,
	) {
		parent::__construct();
	}
}
