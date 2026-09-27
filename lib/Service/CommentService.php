<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Comment;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\Seen;
use OCA\Deliver\Db\SeenMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;
use OCP\Files\NotFoundException;

/**
 * Comments on one Version, anchored to Frames. Who may do what is decided
 * before a request gets here: the Viewer carries what the person's folder
 * permissions or Share Link allow.
 */
class CommentService {
	public function __construct(
		private CommentMapper $comments,
		private SeenMapper $seen,
		private VersionMapper $versions,
		private ITimeFactory $time,
		private NotificationService $notifications,
		private ReviewerMail $mail,
		private Authors $authors,
		private ApprovalService $approvals,
	) {
	}

	public function list(Viewer $viewer, Version $version): array {
		return $this->payload($viewer, $version, $this->comments->findByVersion($version->getId()));
	}

	/**
	 * The Comments written or changed since a timestamp, plus the ids of all
	 * that still exist, so the client can drop what someone else deleted.
	 */
	public function changes(Viewer $viewer, Version $version, int $since): array {
		$payload = $this->payload($viewer, $version, $this->comments->findChangedSince($version->getId(), $since));
		$payload['ids'] = array_map(
			static fn (Comment $comment) => $comment->getId(),
			$this->comments->findByVersion($version->getId()),
		);
		return $payload;
	}

	/**
	 * @param ?int $outFrame the out Frame of a Range, inclusive; null for a single Frame
	 * @throws AccessDeniedException commenting is not allowed here
	 * @throws InvalidRequestException the body is empty, the anchor is backwards, or a Reply would nest
	 * @throws ProjectConflictException the Version is an older one and Comments on older Versions are off
	 */
	public function create(Viewer $viewer, Version $version, int $inFrame, ?int $outFrame, string $body, ?int $parentId, mixed $annotation = null): array {
		if (!$viewer->canComment) {
			throw new AccessDeniedException('Commenting is switched off here');
		}
		if (!$this->opensForComments($viewer, $version)) {
			throw new ProjectConflictException('Only the newest Version takes Comments here');
		}
		$body = trim($body);
		if ($body === '') {
			throw new InvalidRequestException('A Comment needs a body');
		}
		$drawing = Annotation::encode($annotation);
		$parent = $parentId === null ? null : $this->comments->find($parentId);
		if ($parentId !== null && ($parent === null || $parent->getVersionId() !== $version->getId())) {
			throw new NotFoundException('Comment not found');
		}
		if ($parent !== null && $parent->getParentId() !== null) {
			throw new InvalidRequestException('A Reply cannot carry Replies');
		}
		if ($parent !== null && $drawing !== null) {
			throw new InvalidRequestException('A Reply carries no drawing; draw in a Comment of its own');
		}
		if ($parent !== null) {
			// A Reply takes its parent's anchor, whatever the client sent
			$inFrame = $parent->getInFrame();
			$outFrame = $parent->getOutFrame();
		}
		if ($inFrame < 0 || ($outFrame !== null && $outFrame < $inFrame)) {
			throw new InvalidRequestException('A Range runs from its in Frame to its out Frame');
		}

		$now = $this->time->getTime();
		$comment = new Comment();
		$comment->setVersionId($version->getId());
		$comment->setParentId($parent?->getId());
		$viewer->stamp($comment);
		$comment->setInFrame($inFrame);
		$comment->setOutFrame($outFrame);
		$comment->setBody($body);
		$comment->setAnnotation($drawing);
		$comment->setCreatedAt($now);
		$comment->setUpdatedAt($now);
		$comment = $this->comments->insert($comment);
		$serialized = $this->serialize($comment);
		$this->notifications->commented($comment, $version);
		if ($parent !== null) {
			$this->mail->replied($comment, $version, $serialized['author']['name']);
		}
		return $serialized;
	}

	/** @throws AccessDeniedException the Comment belongs to someone else */
	public function update(Viewer $viewer, Version $version, int $id, string $body): array {
		$comment = $this->reach($version, $id);
		if (!$viewer->owns($comment)) {
			throw new AccessDeniedException('Only the author can change a Comment');
		}
		$body = trim($body);
		if ($body === '') {
			throw new InvalidRequestException('A Comment needs a body');
		}
		$comment->setBody($body);
		$comment->setUpdatedAt($this->time->getTime());
		return $this->serialize($this->comments->update($comment));
	}

	/**
	 * Deletes a Comment with its Replies. Write access deletes any; an author
	 * deletes their own as long as nobody else has replied to it.
	 *
	 * @throws AccessDeniedException not the author, or others have replied
	 */
	public function remove(Viewer $viewer, Version $version, int $id): void {
		$comment = $this->reach($version, $id);
		$replies = $this->comments->findByParent($comment->getId());
		if (!$viewer->canWrite) {
			if (!$viewer->owns($comment)) {
				throw new AccessDeniedException('Only the author or a Member with write access can delete this Comment');
			}
			foreach ($replies as $reply) {
				if (!$viewer->owns($reply)) {
					throw new AccessDeniedException('Others have replied to this Comment, so only a Member with write access can delete it');
				}
			}
		}
		foreach ([...$replies, $comment] as $gone) {
			$this->comments->delete($gone);
			$this->notifications->commentDeleted($gone->getId());
		}
	}

	/** @throws AccessDeniedException only write access resolves */
	public function setResolved(Viewer $viewer, Version $version, int $id, bool $resolved): array {
		$comment = $this->reach($version, $id);
		if (!$viewer->canWrite) {
			throw new AccessDeniedException('Write permission on the folder is required to resolve a Comment');
		}
		if ($comment->getParentId() !== null) {
			throw new InvalidRequestException('Replies are not resolved on their own');
		}
		$comment->setResolved($resolved);
		$comment->setUpdatedAt($this->time->getTime());
		return $this->serialize($this->comments->update($comment));
	}

	/** Moves the person's Unseen mark forward, never back */
	public function markSeen(Viewer $viewer, Version $version, ?int $at): array {
		if ($viewer->uid === null && $viewer->reviewerId === null) {
			// Nobody to remember it for until the Reviewer gives a name
			return ['seenUntil' => 0];
		}
		$at ??= $this->time->getTime();
		$seen = $this->seenFor($viewer, $version->getId());
		if ($seen === null) {
			$seen = new Seen();
			$seen->setVersionId($version->getId());
			$seen->setUserId($viewer->uid);
			$seen->setReviewerId($viewer->reviewerId);
			$seen->setSeenUntil($at);
			try {
				return ['seenUntil' => $this->seen->insert($seen)->getSeenUntil()];
			} catch (DbException $e) {
				if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				// Another tab was first; move its mark instead
				$seen = $this->seenFor($viewer, $version->getId()) ?? throw $e;
			}
		}
		if ($at > $seen->getSeenUntil()) {
			$seen->setSeenUntil($at);
			$seen = $this->seen->update($seen);
		}
		return ['seenUntil' => $seen->getSeenUntil()];
	}

	/** @throws NotFoundException no such Comment */
	public function versionIdOf(int $commentId): int {
		$comment = $this->comments->find($commentId);
		if ($comment === null) {
			throw new NotFoundException('Comment not found');
		}
		return $comment->getVersionId();
	}

	/** @throws NotFoundException the Comment is not on this Version */
	private function reach(Version $version, int $id): Comment {
		$comment = $this->comments->find($id);
		if ($comment === null || $comment->getVersionId() !== $version->getId()) {
			throw new NotFoundException('Comment not found');
		}
		return $comment;
	}

	private function seenFor(Viewer $viewer, int $versionId): ?Seen {
		return $viewer->reviewerId === null
			? $this->seen->findForUser($versionId, (string)$viewer->uid)
			: $this->seen->findForReviewer($versionId, $viewer->reviewerId);
	}

	/** The newest Version of a Stack takes Comments; older ones only where allowed (story 41) */
	private function opensForComments(Viewer $viewer, Version $version): bool {
		if ($viewer->canCommentOnOlder) {
			return true;
		}
		$stack = $this->versions->findByAsset($version->getAssetId());
		$newest = end($stack);
		return $newest === false || $newest->getId() === $version->getId();
	}

	/**
	 * @param Comment[] $comments
	 * @return array<string, mixed>
	 */
	private function payload(Viewer $viewer, Version $version, array $comments): array {
		$seen = $this->seenFor($viewer, $version->getId());
		return [
			'versionId' => $version->getId(),
			'state' => $version->getState(),
			'canWrite' => $viewer->canWrite,
			'canComment' => $viewer->canComment && $this->opensForComments($viewer, $version),
			'seenUntil' => $seen?->getSeenUntil() ?? 0,
			// In the same shape as a Comment's author, so the client can spot its own
			'me' => $viewer->identity(),
			'now' => $this->time->getTime(),
			'comments' => array_map(fn (Comment $comment) => $this->serialize($comment), $comments),
			// Few and small, so every answer carries them all
			'approvals' => $this->approvals->list($version),
		];
	}

	private function serialize(Comment $comment): array {
		return [
			'id' => $comment->getId(),
			'versionId' => $comment->getVersionId(),
			'parentId' => $comment->getParentId(),
			'author' => $this->author($comment),
			'inFrame' => $comment->getInFrame(),
			'outFrame' => $comment->getOutFrame(),
			'body' => $comment->getBody(),
			'resolved' => (bool)$comment->getResolved(),
			'annotation' => Annotation::decode($comment->getAnnotation()),
			'createdAt' => $comment->getCreatedAt(),
			'updatedAt' => $comment->getUpdatedAt(),
		];
	}

	private function author(Comment $comment): array {
		return $this->authors->of($comment->getUserId(), $comment->getReviewerId());
	}
}
