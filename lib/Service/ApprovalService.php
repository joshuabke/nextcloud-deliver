<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Approval;
use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\Version;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;

/**
 * Approvals (story 88): whoever may comment on a Version approves it or
 * requests changes; one decision per person, which they change or take back.
 */
class ApprovalService {
	public const APPROVED = 'approved';
	public const CHANGES = 'changes';

	public function __construct(
		private ApprovalMapper $approvals,
		private Authors $authors,
		private ITimeFactory $time,
		private NotificationService $notifications,
		private LiveUpdates $live,
		private CommentWindow $window,
	) {
	}

	/** @return list<array{author: array, status: string, updatedAt: int}> every decision on the Version, oldest first */
	public function list(Version $version): array {
		return array_map(fn (Approval $approval) => [
			'author' => $this->authors->of($approval->getUserId(), $approval->getReviewerId()),
			'status' => $approval->getStatus(),
			'updatedAt' => $approval->getUpdatedAt(),
		], $this->approvals->findByVersion($version->getId()));
	}

	/**
	 * @param ?string $status approved, changes, or null to take the decision back
	 * @throws AccessDeniedException only who may comment decides
	 * @throws InvalidRequestException an unknown status
	 * @return list<array{author: array, status: string, updatedAt: int}>
	 */
	public function decide(Viewer $viewer, Version $version, ?string $status): array {
		if (!$viewer->canComment || ($viewer->uid === null && $viewer->reviewerId === null)) {
			throw new AccessDeniedException('Only who may comment approves');
		}
		if (!$this->window->open($viewer, $version)) {
			throw new ProjectConflictException('Only the newest Version is decided on here');
		}
		if ($status !== null && !in_array($status, [self::APPROVED, self::CHANGES], true)) {
			throw new InvalidRequestException('A decision is approved or changes');
		}
		$mine = $this->mine($viewer, $version);
		if ($status === null) {
			if ($mine !== null) {
				$this->approvals->delete($mine);
				$this->live->changed($version);
			}
			return $this->list($version);
		}
		if ($mine?->getStatus() === $status) {
			return $this->list($version);
		}
		$new = $mine === null;
		if ($mine === null) {
			$mine = new Approval();
			$mine->setVersionId($version->getId());
			$mine->setUserId($viewer->uid);
			$mine->setReviewerId($viewer->reviewerId);
		}
		$mine->setStatus($status);
		$mine->setUpdatedAt($this->time->getTime());
		try {
			$new ? $this->approvals->insert($mine) : $this->approvals->update($mine);
		} catch (DbException $e) {
			// Another tab decided in the same moment; its decision stands
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
		$this->notifications->decided($version, $status, $viewer->uid, $this->authors->of($viewer->uid, $viewer->reviewerId)['name']);
		$this->live->changed($version);
		return $this->list($version);
	}

	private function mine(Viewer $viewer, Version $version): ?Approval {
		foreach ($this->approvals->findByVersion($version->getId()) as $approval) {
			if ($viewer->reviewerId !== null ? $approval->getReviewerId() === $viewer->reviewerId : $approval->getUserId() === $viewer->uid) {
				return $approval;
			}
		}
		return null;
	}
}
