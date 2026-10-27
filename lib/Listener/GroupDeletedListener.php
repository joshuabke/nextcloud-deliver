<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\Db\MemberMapper;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\GroupDeletedEvent;

/**
 * A group id may be given to the next group created, so what Members with
 * Manage set for the old one must not pass to it (ADR 0016).
 *
 * @template-implements IEventListener<GroupDeletedEvent>
 */
class GroupDeletedListener implements IEventListener {
	public function __construct(
		private MemberMapper $members,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof GroupDeletedEvent) {
			$this->members->deleteByPrincipal(MemberMapper::GROUP, $event->getGroup()->getGID());
		}
	}
}
