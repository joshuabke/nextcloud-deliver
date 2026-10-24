<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Someone who reaches a Version through a Review Link instead of Files
 * permissions. The secret key is their identity: a Personal Link carries it,
 * so the same person is the same author on any device, forever.
 *
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
 * @method ?int getProjectId()
 * @method void setProjectId(?int $projectId)
 * @method string getName()
 * @method void setName(string $name)
 * @method ?string getEmail()
 * @method void setEmail(?string $email)
 * @method ?string getSecretKey()
 * @method void setSecretKey(?string $secretKey)
 * @method ?bool getMailReplies()
 * @method void setMailReplies(?bool $mailReplies)
 * @method ?bool getMailComments()
 * @method void setMailComments(?bool $mailComments)
 * @method ?bool getMailVersions()
 * @method void setMailVersions(?bool $mailVersions)
 * @method ?string getLanguage()
 * @method void setLanguage(?string $language)
 * @method ?bool getInContacts()
 * @method void setInContacts(?bool $inContacts)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Reviewer extends Entity {
	/** The Member they belong to: who invited them, or whose Review Link they named themselves on */
	protected string $ownerUid = '';
	/** The Project whose links they come by (ADR 0013); null for the Member's links on No Project */
	protected ?int $projectId = null;
	protected ?string $name = null;
	protected ?string $email = null;
	protected ?string $secretKey = null;
	protected ?int $createdAt = null;
	/** What they want mailed; null is the default: Replies yes, the rest no */
	protected ?bool $mailReplies = null;
	protected ?bool $mailComments = null;
	protected ?bool $mailVersions = null;
	/** de or en, for the mails to them; null leaves it to the request that sends one */
	protected ?string $language = null;
	/** Whether their address is in one of the Member's address books (#66); null until checked */
	protected ?bool $inContacts = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('createdAt', 'integer');
		$this->addType('mailReplies', 'boolean');
		$this->addType('mailComments', 'boolean');
		$this->addType('mailVersions', 'boolean');
		$this->addType('inContacts', 'boolean');
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
