<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ReviewerMapper;
use OCP\IL10N;
use OCP\IUserManager;

/** Who wrote or decided something, in the shape the client shows: type, id, name */
class Authors {
	public function __construct(
		private ReviewerMapper $reviewers,
		private IUserManager $users,
		private IL10N $l,
	) {
	}

	/**
	 * @param list<string> $uids
	 * @return array<string, string> user id → display name, for the users that exist
	 */
	public function names(array $uids): array {
		$names = [];
		foreach ($uids as $uid) {
			$name = $this->users->getDisplayName($uid);
			if ($name !== null) {
				$names[$uid] = $name;
			}
		}
		return $names;
	}

	/** @return array{type: string, id: int|string, name: string} */
	public function of(?string $uid, ?int $reviewerId): array {
		if ($reviewerId !== null) {
			return ['type' => 'reviewer', 'id' => $reviewerId, 'name' => $this->reviewers->find($reviewerId)?->getName() ?? ''];
		}
		if ($uid === null) {
			// What a deleted account left, its user id handed back (UserDeletedListener)
			return ['type' => 'deleted', 'id' => '', 'name' => $this->l->t('Deleted user')];
		}
		return ['type' => 'user', 'id' => $uid, 'name' => $this->users->getDisplayName($uid) ?? $uid];
	}
}
