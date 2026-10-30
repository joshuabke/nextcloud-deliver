<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\Files\IRootFolder;
use OCP\Share\IManager as IShareManager;

/** Members of a Version: whoever Files lets open its file, the owner included (ADR 0009) */
class Members {
	public function __construct(
		private IRootFolder $root,
		private IShareManager $shares,
		private ProjectMapper $projects,
		private Access $access,
	) {
	}

	/**
	 * Those of them who are not kept out of the Version's Project: the ones to
	 * notify, to mention and to tell of changes (ADR 0016)
	 *
	 * @return list<string> user ids
	 */
	public function inReview(Version $version): array {
		$members = $this->of($version->getFileId());
		$projectId = $version->getProjectId();
		if ($projectId === null || $members === []) {
			return $members;
		}
		try {
			$project = $this->projects->find($projectId);
		} catch (DoesNotExistException) {
			return $members;
		}
		return array_values(array_filter($members, fn (string $uid) => $this->access->sees($uid, $project)));
	}

	/** @return list<string> user ids; none while the file is only in the trash */
	public function of(int $nodeId): array {
		$node = null;
		foreach ($this->root->getById($nodeId) as $candidate) {
			// The trash has no shares and no access list
			if (Access::isOwnersCopy($candidate)) {
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
