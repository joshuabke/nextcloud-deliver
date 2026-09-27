<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * How far one person has read a Version's Comments. Everything written after
 * `seenUntil` is Unseen for them.
 *
 * @method int getVersionId()
 * @method void setVersionId(int $versionId)
 * @method ?string getUserId()
 * @method void setUserId(?string $userId)
 * @method ?int getReviewerId()
 * @method void setReviewerId(?int $reviewerId)
 * @method int getSeenUntil()
 * @method void setSeenUntil(int $seenUntil)
 */
class Seen extends Entity {
	protected int $versionId = 0;
	protected ?string $userId = null;
	protected ?int $reviewerId = null;
	protected ?int $seenUntil = null;

	public function __construct() {
		$this->addType('versionId', 'integer');
		$this->addType('reviewerId', 'integer');
		$this->addType('seenUntil', 'integer');
	}
}
