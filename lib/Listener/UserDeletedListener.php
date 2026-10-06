<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\ProjectLinkMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\StackService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\IRootFolder;
use OCP\IDBConnection;
use OCP\User\Events\UserDeletedEvent;

/**
 * Nextcloud hands a deleted account's user id to whoever is created under it
 * next, so nothing of Deliver may stay tied to it. A Folder Project passes to
 * whoever owns the folder, any other Project is removed as by its maker (its
 * Assets go to No Project), the account's links and Reviewers go, and its
 * Comments, Approvals and Reactions stay, by a Deleted user.
 *
 * @template-implements IEventListener<UserDeletedEvent>
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private ProjectMapper $projects,
		private ProjectLinkMapper $links,
		private LinkActivityMapper $activity,
		private ReviewerMapper $reviewerMapper,
		private ReviewerService $reviewers,
		private StackService $stacks,
		private IRootFolder $root,
		private IUserMountCache $mounts,
		private IDBConnection $db,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$uid = $event->getUser()->getUID();
		foreach ($this->projects->findAll() as $project) {
			if ($project->getOwnerUid() !== $uid) {
				continue;
			}
			$owner = $this->folderOwner($project->getFolderId(), $uid);
			if ($owner === null) {
				$this->stacks->removeProject($project, $uid);
			} else {
				$project->setOwnerUid($owner);
				$this->projects->update($project);
			}
		}
		foreach ($this->links->findByOwner($uid) as $link) {
			$this->activity->deleteByToken($link->getToken());
			$this->links->delete($link);
		}
		foreach ($this->reviewerMapper->findByOwners([$uid]) as $reviewer) {
			$this->reviewers->remove($reviewer);
		}
		foreach (['deliver_seen', 'deliver_mutes'] as $table) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($table)->where($qb->expr()->eq('user_id', $qb->createNamedParameter($uid)))->executeStatement();
		}
		foreach (['deliver_comments' => 'user_id', 'deliver_approvals' => 'user_id', 'deliver_reactions' => 'user_id', 'deliver_assets' => 'enabled_by'] as $table => $column) {
			$qb = $this->db->getQueryBuilder();
			$qb->update($table)->set($column, $qb->createNamedParameter(null))
				->where($qb->expr()->eq($column, $qb->createNamedParameter($uid)))->executeStatement();
		}
	}

	/**
	 * Whoever owns the folder, found through anyone who still mounts it: the
	 * account's own files are gone by now, and the root folder only knows the
	 * mounts of the request's user.
	 */
	private function folderOwner(?int $folderId, string $deleted): ?string {
		foreach ($folderId === null ? [] : $this->mounts->getMountsForFileId($folderId) as $mount) {
			$uid = $mount->getUser()->getUID();
			$owner = $uid === $deleted ? null : $this->root->getUserFolder($uid)->getFirstNodeById($folderId)?->getOwner()?->getUID();
			if ($owner !== null) {
				return $owner;
			}
		}
		return null;
	}
}
