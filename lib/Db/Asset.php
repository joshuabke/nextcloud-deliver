<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method int getProjectId()
 * @method void setProjectId(int $projectId)
 * @method int getParentId()
 * @method void setParentId(int $parentId)
 * @method ?string getNameOverride()
 * @method ?string getDueDate()
 * @method void setDueDate(?string $dueDate)
 * @method ?string getDueReminded()
 * @method void setDueReminded(?string $dueReminded)
 */
class Asset extends Entity {
	protected int $projectId = 0;
	protected int $parentId = 0;
	protected ?string $nameOverride = null;
	/** A calendar day, YYYY-MM-DD (story 93) */
	protected ?string $dueDate = null;
	/** The reminder sent last, as day:stage, so each goes out once */
	protected ?string $dueReminded = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('parentId', 'integer');
	}
}
