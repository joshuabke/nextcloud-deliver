<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Comment;

/**
 * Who is looking at a Version and what they may do. A Member's rights come
 * from the Version's file (ADR 0009), a Reviewer's from the Share Link (ADR 0004); past
 * this point both are handled alike.
 */
final class Viewer {
	private function __construct(
		public readonly ?string $uid,
		public readonly ?int $reviewerId,
		/** Resolve, and delete other people's Comments */
		public readonly bool $canWrite,
		public readonly bool $canComment,
		/** Comment on a Version that is not the newest in its Stack */
		public readonly bool $canCommentOnOlder,
		/** Someone on a Share Link who may comment as soon as they give a name */
		public readonly bool $canCommentOnceNamed = false,
	) {
	}

	public static function member(string $uid, bool $canWrite, bool $canCommentOnOlder): self {
		return new self($uid, null, $canWrite, true, $canCommentOnOlder);
	}

	/** A Reviewer never resolves and never touches what they did not write */
	public static function reviewer(int $reviewerId, bool $canComment, bool $canCommentOnOlder): self {
		return new self(null, $reviewerId, false, $canComment, $canCommentOnOlder);
	}

	/**
	 * Someone on a Share Link who has not given a name yet: reads, but does
	 * not write. Where the link takes Comments, the Review view asks for the
	 * name instead of saying that commenting is off.
	 */
	public static function unnamed(bool $shareTakesComments, bool $canCommentOnOlder): self {
		return new self(null, null, false, false, $canCommentOnOlder, $shareTakesComments);
	}

	public function owns(Comment $comment): bool {
		return $this->reviewerId === null
			? $this->uid !== null && $comment->getUserId() === $this->uid
			: $comment->getReviewerId() === $this->reviewerId;
	}

	/** In the shape of a Comment's author, so the client recognises its own Comments */
	public function identity(): array {
		return match (true) {
			$this->reviewerId !== null => ['type' => 'reviewer', 'id' => $this->reviewerId],
			$this->uid !== null => ['type' => 'user', 'id' => $this->uid],
			default => ['type' => 'unnamed', 'id' => null],
		};
	}

	public function stamp(Comment $comment): void {
		$comment->setUserId($this->uid);
		$comment->setReviewerId($this->reviewerId);
	}
}
