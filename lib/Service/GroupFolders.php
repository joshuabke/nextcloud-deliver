<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\Node;
use OCP\Server;

/**
 * What the Group folders app (Team folders) says about a node. Its classes are
 * named, not imported: the app need not be there.
 */
class GroupFolders {
	private const MOUNT = 'OCA\\GroupFolders\\Mount\\GroupMountPoint';
	private const MANAGER = 'OCA\\GroupFolders\\Folder\\FolderManager';

	/** Whether the node lies in a group folder, which belongs to nobody */
	public function holds(Node $node): bool {
		return is_a($node->getMountPoint(), self::MOUNT);
	}

	/**
	 * The groups a group folder is given to, with the permissions it gives each.
	 *
	 * @return array<string, int> group id => permissions; empty outside a group folder
	 */
	public function groupsOf(Node $node): array {
		if (!$this->holds($node)) {
			return [];
		}
		/** @psalm-suppress UndefinedInterfaceMethod, MixedMethodCall The app's classes are not known here */
		$folder = Server::get(self::MANAGER)->getFolder($node->getMountPoint()->getFolderId());
		// Older versions of the app answer an array, newer ones an object; either keeps "groups"
		$applicable = is_array($folder) ? ($folder['groups'] ?? []) : ($folder->groups ?? []);
		$groups = [];
		foreach ($applicable as $gid => $each) {
			// A circle is not a group of Nextcloud
			if (is_array($each) && ($each['type'] ?? 'group') !== 'group') {
				continue;
			}
			$groups[(string)$gid] = (int)(is_array($each) ? $each['permissions'] : $each);
		}
		return $groups;
	}
}
