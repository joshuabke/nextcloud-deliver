<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A Comment anchors to a Frame, or to a Range when it has an out Frame.
 * Frames are counted at the Version's frame rate; seconds are never stored.
 * The author is a Nextcloud user or a Reviewer, never both.
 *
 * @method int getVersionId()
 * @method void setVersionId(int $versionId)
 * @method ?int getParentId()
 * @method void setParentId(?int $parentId)
 * @method ?string getUserId()
 * @method void setUserId(?string $userId)
 * @method ?int getReviewerId()
 * @method void setReviewerId(?int $reviewerId)
 * @method int getInFrame()
 * @method void setInFrame(int $inFrame)
 * @method ?int getOutFrame()
 * @method void setOutFrame(?int $outFrame)
 * @method string getBody()
 * @method void setBody(string $body)
 * @method ?bool getResolved()
 * @method void setResolved(bool $resolved)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method ?string getAnnotation()
 * @method void setAnnotation(?string $annotation)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 */
class Comment extends Entity {
	protected int $versionId = 0;
	protected ?int $parentId = null;
	protected ?string $userId = null;
	protected ?int $reviewerId = null;
	protected ?int $inFrame = null;
	protected ?int $outFrame = null;
	protected ?string $body = null;
	/** Null and false mean the same thing; Entity setters skip values equal to the default */
	protected ?bool $resolved = null;
	protected ?int $createdAt = null;
	protected ?int $updatedAt = null;
	/** A drawing on the Frame, as JSON (Annotation) */
	protected ?string $annotation = null;

	public function __construct() {
		$this->addType('versionId', 'integer');
		$this->addType('parentId', 'integer');
		$this->addType('reviewerId', 'integer');
		$this->addType('inFrame', 'integer');
		$this->addType('outFrame', 'integer');
		$this->addType('resolved', 'boolean');
		$this->addType('createdAt', 'integer');
		$this->addType('updatedAt', 'integer');
	}
}
