<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One person's emoji on a Comment.
 *
 * @method int getCommentId()
 * @method void setCommentId(int $commentId)
 * @method ?string getUserId()
 * @method void setUserId(?string $userId)
 * @method ?int getReviewerId()
 * @method void setReviewerId(?int $reviewerId)
 * @method string getEmoji()
 * @method void setEmoji(string $emoji)
 */
class Reaction extends Entity {
	protected int $commentId = 0;
	protected ?string $userId = null;
	protected ?int $reviewerId = null;
	protected ?string $emoji = null;

	public function __construct() {
		$this->addType('commentId', 'integer');
		$this->addType('reviewerId', 'integer');
	}
}
