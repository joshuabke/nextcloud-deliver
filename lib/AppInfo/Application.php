<?php

declare(strict_types=1);

namespace OCA\Deliver\AppInfo;

use OCA\Deliver\Listener\FileEventsListener;
use OCA\Deliver\Listener\LoadSidebarListener;
use OCA\Deliver\Listener\UserDeletedListener;
use OCA\Deliver\Notification\Notifier;
use OCA\Deliver\SetupCheck\BackgroundJobsCheck;
use OCA\Deliver\SetupCheck\MediaJobsCheck;
use OCA\Files\Event\LoadSidebar;
use OCA\Files_Trashbin\Events\MoveToTrashEvent;
use OCA\Files_Trashbin\Events\NodeRestoredEvent;
use OCA\Files_Versions\Events\VersionRestoredEvent;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\User\Events\UserDeletedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'deliver';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerNotifierService(Notifier::class);
		// Shown on the admin overview, where a hosted Nextcloud's admin looks without a shell
		$context->registerSetupCheck(BackgroundJobsCheck::class);
		$context->registerSetupCheck(MediaJobsCheck::class);
		$context->registerEventListener(LoadSidebar::class, LoadSidebarListener::class);
		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
		// Files is the source of truth, so Deliver follows its events (ADR 0002)
		foreach ([NodeCreatedEvent::class, NodeWrittenEvent::class, VersionRestoredEvent::class, NodeRenamedEvent::class, NodeDeletedEvent::class, MoveToTrashEvent::class, NodeRestoredEvent::class] as $event) {
			$context->registerEventListener($event, FileEventsListener::class);
		}
	}

	public function boot(IBootContext $context): void {
	}
}
