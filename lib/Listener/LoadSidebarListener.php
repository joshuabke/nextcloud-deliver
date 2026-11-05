<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\AppInfo\Application;
use OCA\Files\Event\LoadSidebar;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Security\IContentSecurityPolicyManager;
use OCP\Util;

/** @template-implements IEventListener<LoadSidebar> */
class LoadSidebarListener implements IEventListener {
	public function __construct(
		private IContentSecurityPolicyManager $policies,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof LoadSidebar) {
			Util::addScript(Application::APP_ID, 'deliver-sidebar');
			// Only on the pages Deliver's script runs on
			$this->policies->addDefaultPolicy(Application::allowWasm(new EmptyContentSecurityPolicy()));
		}
	}
}
