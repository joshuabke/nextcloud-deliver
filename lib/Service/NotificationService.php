<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Comment;
use OCA\Deliver\Db\MuteMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Db\Version;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Notification\IManager as INotificationManager;

/**
 * Nextcloud notifications for Members (spec: Notifications): new Comments
 * and Replies, new Versions, automatic stacks, Missing files, approvals. Members are
 * whoever can reach the Project folder, minus the person who caused the
 * event and anyone who muted the Project.
 */
class NotificationService {
	public const COMMENT = 'comment';
	public const REPLY = 'reply';
	public const VERSION = 'version';
	public const AUTO_STACK = 'autostack';
	public const MISSING = 'missing';
	public const APPROVED = 'approved';
	public const CHANGES = 'changes';
	public const MENTION = 'mention';
	public const DUE_TOMORROW = 'due_tomorrow';
	public const DUE_TODAY = 'due_today';

	public function __construct(
		private INotificationManager $notifications,
		private Members $members,
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private MuteMapper $mutes,
		private ReviewerMapper $reviewers,
		private IUserManager $users,
		private IUserSession $userSession,
		private ITimeFactory $time,
	) {
	}

	/**
	 * A new Comment or Reply (story 62). Members it @mentions hear of it as a
	 * mention, even from a Project they muted (story 90), and not twice.
	 */
	public function commented(Comment $comment, Version $version): void {
		$uid = $comment->getUserId();
		$author = $uid !== null
			? ($this->users->get($uid)?->getDisplayName() ?? $uid)
			: ($this->reviewers->find((int)$comment->getReviewerId())?->getName() ?? '');
		$parameters = ['author' => $author, 'body' => mb_substr($comment->getBody(), 0, 200)];
		$mentioned = $this->mentioned($comment, $version);
		$this->notify($version, $comment->getParentId() === null ? self::COMMENT : self::REPLY, 'comment', (string)$comment->getId(), $parameters, $comment->getUserId(), $mentioned);
		$this->send($version, self::MENTION, 'comment', (string)$comment->getId(), $parameters, $mentioned);
	}

	/** @return list<string> the Members a Comment mentions, not its author */
	private function mentioned(Comment $comment, Version $version): array {
		try {
			$project = $this->projects->find($version->getProjectId());
		} catch (DoesNotExistException) {
			return [];
		}
		return array_values(array_diff(
			array_intersect(Mentions::parse($comment->getBody()), $this->members->of($project->getFolderId())),
			[$comment->getUserId()],
		));
	}

	/** A Comment is gone, and so are the notifications about it */
	public function commentDeleted(int $commentId): void {
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)->setObject('comment', (string)$commentId);
		$this->notifications->markProcessed($notification);
	}

	/** A new Version, or one the filename convention stacked on its own (story 63) */
	public function versionArrived(Version $version): void {
		$this->notify(
			$version,
			$version->getAutoStacked() ? self::AUTO_STACK : self::VERSION,
			'version',
			(string)$version->getId(),
			['file' => $version->getName()],
			$this->userSession->getUser()?->getUID(),
		);
	}

	/** An Asset is due tomorrow or today (story 93); nobody caused it, so every Member hears */
	public function due(Version $newest, bool $today): void {
		$this->notify($newest, $today ? self::DUE_TODAY : self::DUE_TOMORROW, 'asset', (string)$newest->getAssetId(), [], null);
	}

	/** Someone approved a Version or requested changes (story 88) */
	public function decided(Version $version, string $status, ?string $actor, string $author): void {
		$subject = $status === ApprovalService::APPROVED ? self::APPROVED : self::CHANGES;
		$this->notify($version, $subject, 'approval', $version->getId() . ':' . $author, ['author' => $author], $actor);
	}

	/** The file of a Version left the Project folder or went to the trash (stories 18 and 63) */
	public function versionMissing(Version $version): void {
		$this->notify($version, self::MISSING, 'version', (string)$version->getId(), ['file' => $version->getName()], $this->userSession->getUser()?->getUID());
	}

	/**
	 * ponytail: one notification per Member and event, sent in the request; batch or defer to a job if Projects get large
	 *
	 * @param array<string, string> $parameters shown by the Notifier
	 * @param list<string> $exclude who hears of it otherwise
	 */
	private function notify(Version $version, string $subject, string $objectType, string $objectId, array $parameters, ?string $actor, array $exclude = []): void {
		try {
			$project = $this->projects->find($version->getProjectId());
		} catch (DoesNotExistException) {
			return;
		}
		$recipients = array_diff($this->members->of($project->getFolderId()), $this->mutes->mutedBy($project->getId()), [$actor], $exclude);
		$this->send($version, $subject, $objectType, $objectId, $parameters, array_values($recipients));
	}

	/**
	 * @param array<string, string> $parameters shown by the Notifier
	 * @param list<string> $recipients user ids
	 */
	private function send(Version $version, string $subject, string $objectType, string $objectId, array $parameters, array $recipients): void {
		if ($recipients === []) {
			return;
		}
		$asset = $this->assets->find($version->getAssetId());
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setDateTime(new \DateTime('@' . $this->time->getTime()))
			->setObject($objectType, $objectId)
			->setSubject($subject, $parameters + [
				'versionId' => (string)$version->getId(),
				'number' => (string)$version->getNumber(),
				'asset' => $asset === null ? $version->getName() : ($asset->getNameOverride() ?? VersionNaming::assetName($version->getName())),
			]);
		foreach ($recipients as $uid) {
			$notification->setUser($uid);
			$this->notifications->notify($notification);
		}
	}
}
