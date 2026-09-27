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
 */
class Asset extends Entity {
	protected int $projectId = 0;
	protected int $parentId = 0;
	protected ?string $nameOverride = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('parentId', 'integer');
	}
}
