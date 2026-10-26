<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method ?int getFolderId()
 * @method void setFolderId(?int $folderId)
 * @method ?string getName()
 * @method void setName(?string $name)
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
 * @method ?bool getAutoIntake()
 * @method void setAutoIntake(bool $autoIntake)
 * @method ?bool getAllowOlder()
 * @method void setAllowOlder(bool $allowOlder)
 * @method void setFpsNum(int $fpsNum)
 * @method void setFpsDen(int $fpsDen)
 * @method void setTimecodeMode(string $timecodeMode)
 * @method int getFpsNum()
 * @method int getFpsDen()
 * @method string getTimecodeMode()
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method ?int getDeletedAt()
 * @method void setDeletedAt(?int $deletedAt)
 * @method ?string getDeletedBy()
 * @method void setDeletedBy(?string $deletedBy)
 */
class Project extends Entity {
	/** Set for a Folder Project only (ADR 0009) */
	protected ?int $folderId = null;
	protected ?string $name = null;
	protected string $ownerUid = '';
	/** Null and false mean the same thing; Entity setters skip values equal to the default */
	protected ?bool $autoIntake = null;
	protected ?bool $allowOlder = null;
	protected int $fpsNum = 25;
	protected int $fpsDen = 1;
	protected string $timecodeMode = 'smpte';
	protected int $createdAt = 0;
	/** When and by whom it was deleted: a Deleted Project, until it goes for good (ADR 0015) */
	protected ?int $deletedAt = null;
	protected ?string $deletedBy = null;

	public function __construct() {
		$this->addType('folderId', 'integer');
		$this->addType('deletedAt', 'integer');
		$this->addType('autoIntake', 'boolean');
		$this->addType('allowOlder', 'boolean');
		$this->addType('fpsNum', 'integer');
		$this->addType('fpsDen', 'integer');
		$this->addType('createdAt', 'integer');
	}

	/** A Deleted Project (ADR 0015): nobody opens it, nothing runs for it, and it still holds its files */
	public function isDeleted(): bool {
		return $this->deletedAt !== null;
	}
}
