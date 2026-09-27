<?php

// Classes Deliver uses from Nextcloud's server and bundled apps, which the
// OCP package does not ship. Signatures as far as Deliver relies on them;
// Psalm reads this file, nothing loads it at run time.

namespace OC\Hooks {
	interface Emitter {
	}
}

namespace OCA\Files\Event {
	class LoadSidebar extends \OCP\EventDispatcher\Event {
	}
}

namespace OCA\Files_Sharing\Event {
	class BeforeTemplateRenderedEvent extends \OCP\EventDispatcher\Event {
		public function getShare(): \OCP\Share\IShare {
		}

		public function getScope(): ?string {
		}
	}
}

namespace OCA\Files_Trashbin\Events {
	class MoveToTrashEvent extends \OCP\EventDispatcher\Event {
		public function getNode(): \OCP\Files\Node {
		}
	}

	class NodeRestoredEvent extends \OCP\Files\Events\Node\AbstractNodesEvent {
	}
}
