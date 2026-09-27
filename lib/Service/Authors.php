<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ReviewerMapper;
use OCP\IUserManager;

/** Who wrote or decided something, in the shape the client shows: type, id, name */
class Authors {
	public function __construct(
		private ReviewerMapper $reviewers,
		private IUserManager $users,
	) {
	}

	/** @return array{type: string, id: int|string, name: string} */
	public function of(?string $uid, ?int $reviewerId): array {
		if ($reviewerId !== null) {
			return ['type' => 'reviewer', 'id' => $reviewerId, 'name' => $this->reviewers->find($reviewerId)?->getName() ?? ''];
		}
		$uid = (string)$uid;
		return ['type' => 'user', 'id' => $uid, 'name' => $this->users->get($uid)?->getDisplayName() ?? $uid];
	}
}
