<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Someone who reaches a Version through a Share Link instead of Files
 * permissions. The secret key is their identity: a Personal Link carries it,
 * so the same person is the same author on any device, forever.
 *
 * @method int getProjectId()
 * @method void setProjectId(int $projectId)
 * @method string getName()
 * @method void setName(string $name)
 * @method ?string getEmail()
 * @method void setEmail(?string $email)
 * @method string getSecretKey()
 * @method void setSecretKey(string $secretKey)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Reviewer extends Entity {
	protected int $projectId = 0;
	protected ?string $name = null;
	protected ?string $email = null;
	protected ?string $secretKey = null;
	protected ?int $createdAt = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('createdAt', 'integer');
	}
}
