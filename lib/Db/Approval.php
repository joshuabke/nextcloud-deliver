<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One person's decision on a Version: approved, or changes requested.
 *
 * @method int getVersionId()
 * @method void setVersionId(int $versionId)
 * @method ?string getUserId()
 * @method void setUserId(?string $userId)
 * @method ?int getReviewerId()
 * @method void setReviewerId(?int $reviewerId)
 * @method string getStatus()
 * @method void setStatus(string $status)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $updatedAt)
 */
class Approval extends Entity {
	protected int $versionId = 0;
	protected ?string $userId = null;
	protected ?int $reviewerId = null;
	protected ?string $status = null;
	protected ?int $updatedAt = null;

	public function __construct() {
		$this->addType('versionId', 'integer');
		$this->addType('reviewerId', 'integer');
		$this->addType('updatedAt', 'integer');
	}
}
