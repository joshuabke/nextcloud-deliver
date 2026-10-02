<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Someone who reaches a Version through a Share Link instead of Files
 * permissions. The secret key is their identity: a Personal Link carries it,
 * so the same person is the same author on any device, forever.
 *
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
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
 * @method ?bool getCanComment()
 * @method void setCanComment(?bool $canComment)
 * @method ?bool getAllowOlder()
 * @method void setAllowOlder(?bool $allowOlder)
 * @method ?bool getWatermark()
 * @method void setWatermark(?bool $watermark)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Reviewer extends Entity {
	/** The Member they belong to: who invited them, or whose Share Link they named themselves on */
	protected string $ownerUid = '';
	protected ?string $name = null;
	protected ?string $email = null;
	protected ?string $secretKey = null;
	protected ?int $createdAt = null;
	/** What they want mailed; null is the default: Replies yes, the rest no */
	protected ?bool $mailReplies = null;
	protected ?bool $mailComments = null;
	protected ?bool $mailVersions = null;
	/** Their own rights; null leaves it to the Share Link they come by */
	protected ?bool $canComment = null;
	protected ?bool $allowOlder = null;
	protected ?bool $watermark = null;

	public function __construct() {
		$this->addType('createdAt', 'integer');
		$this->addType('mailReplies', 'boolean');
		$this->addType('mailComments', 'boolean');
		$this->addType('mailVersions', 'boolean');
		$this->addType('canComment', 'boolean');
		$this->addType('allowOlder', 'boolean');
		$this->addType('watermark', 'boolean');
	}

	/** @return array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool} their own rights, null where the link decides */
	public function rights(): array {
		return ['canComment' => $this->getCanComment(), 'allowOlder' => $this->getAllowOlder(), 'watermark' => $this->getWatermark()];
	}

	/**
	 * @param array<string, mixed> $flags a Share Link's review flags
	 * @return array<string, mixed> the flags as they hold for this Reviewer
	 */
	public function over(array $flags): array {
		foreach ($this->rights() as $right => $value) {
			if ($value !== null) {
				$flags[$right] = $value;
			}
		}
		return $flags;
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
