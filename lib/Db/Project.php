<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method int getFolderId()
 * @method void setFolderId(int $folderId)
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
 */
class Project extends Entity {
	protected int $folderId = 0;
	protected string $ownerUid = '';
	/** Null and false mean the same thing; Entity setters skip values equal to the default */
	protected ?bool $autoIntake = null;
	protected ?bool $allowOlder = null;
	protected int $fpsNum = 25;
	protected int $fpsDen = 1;
	protected string $timecodeMode = 'smpte';
	protected int $createdAt = 0;

	public function __construct() {
		$this->addType('folderId', 'integer');
		$this->addType('autoIntake', 'boolean');
		$this->addType('allowOlder', 'boolean');
		$this->addType('fpsNum', 'integer');
		$this->addType('fpsDen', 'integer');
		$this->addType('createdAt', 'integer');
	}
}
