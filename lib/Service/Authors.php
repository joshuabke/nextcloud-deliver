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

	/**
	 * @param list<string> $uids
	 * @return array<string, string> user id → display name, for the users that exist
	 */
	public function names(array $uids): array {
		$names = [];
		foreach ($uids as $uid) {
			$user = $this->users->get($uid);
			if ($user !== null) {
				$names[$uid] = $user->getDisplayName();
			}
		}
		return $names;
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
