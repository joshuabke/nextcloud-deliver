<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\IRootFolder;
use OCP\Share\IManager as IShareManager;

/** Members of a Version: whoever Files lets open its file, the owner included (ADR 0009) */
class Members {
	public function __construct(
		private IRootFolder $root,
		private IShareManager $shares,
	) {
	}

	/** @return list<string> user ids; none while the file is only in the trash */
	public function of(int $nodeId): array {
		$node = null;
		foreach ($this->root->getById($nodeId) as $candidate) {
			// The trash has no shares and no access list
			if (preg_match('#^/[^/]+/files(/|$)#', $candidate->getPath()) === 1) {
				$node = $candidate;
				break;
			}
		}
		if ($node === null) {
			return [];
		}
		$access = $this->shares->getAccessList($node, true, true);
		$members = array_map('strval', array_keys($access['users'] ?? []));
		$owner = $node->getOwner()?->getUID();
		if ($owner !== null) {
			$members[] = $owner;
		}
		return array_values(array_unique($members));
	}
}
