<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\IRootFolder;
use OCP\Share\IManager as IShareManager;

/** Members of a Project: whoever Files lets into its folder, the owner included */
class Members {
	public function __construct(
		private IRootFolder $root,
		private IShareManager $shares,
	) {
	}

	/** @return list<string> user ids */
	public function of(int $folderId): array {
		$folder = $this->root->getFirstNodeById($folderId);
		if ($folder === null) {
			return [];
		}
		$access = $this->shares->getAccessList($folder, true, true);
		$members = array_map('strval', array_keys($access['users'] ?? []));
		$owner = $folder->getOwner()?->getUID();
		if ($owner !== null) {
			$members[] = $owner;
		}
		return array_values(array_unique($members));
	}
}
