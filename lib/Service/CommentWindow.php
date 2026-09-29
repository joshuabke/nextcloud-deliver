<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;

/**
 * The newest Version of a Stack takes Comments, and with them reactions and
 * approvals; older ones only where the Project or the link allows (story 41).
 */
class CommentWindow {
	public function __construct(
		private VersionMapper $versions,
	) {
	}

	public function open(Viewer $viewer, Version $version): bool {
		if ($viewer->canCommentOnOlder) {
			return true;
		}
		$newest = $this->versions->findNewest($version->getAssetId());
		return $newest === null || $newest->getId() === $version->getId();
	}
}
