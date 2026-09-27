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
 * @method ?bool getMailReplies()
 * @method void setMailReplies(?bool $mailReplies)
 * @method ?bool getMailComments()
 * @method void setMailComments(?bool $mailComments)
 * @method ?bool getMailVersions()
 * @method void setMailVersions(?bool $mailVersions)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Reviewer extends Entity {
	protected int $projectId = 0;
	protected ?string $name = null;
	protected ?string $email = null;
	protected ?string $secretKey = null;
	protected ?int $createdAt = null;
	/** What they want mailed; null is the default: Replies yes, the rest no */
	protected ?bool $mailReplies = null;
	protected ?bool $mailComments = null;
	protected ?bool $mailVersions = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('createdAt', 'integer');
		$this->addType('mailReplies', 'boolean');
		$this->addType('mailComments', 'boolean');
		$this->addType('mailVersions', 'boolean');
	}

	/** @return array{replies: bool, comments: bool, versions: bool} what to mail, the defaults filled in */
	public function mailWishes(): array {
		return [
			'replies' => $this->getMailReplies() ?? true,
			'comments' => $this->getMailComments() ?? false,
			'versions' => $this->getMailVersions() ?? false,
		];
	}
}
