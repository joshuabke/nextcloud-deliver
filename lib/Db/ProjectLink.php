<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A review link of Deliver's own for a Project (ADR 0010): the whole Project
 * or picked Assets, with password, expiry, pause and rights of its own.
 *
 * @method int getProjectId()
 * @method void setProjectId(int $projectId)
 * @method string getOwnerUid()
 * @method void setOwnerUid(string $ownerUid)
 * @method string getToken()
 * @method void setToken(string $token)
 * @method ?string getLabel()
 * @method void setLabel(?string $label)
 * @method ?string getDescription()
 * @method void setDescription(?string $description)
 * @method ?string getPasswordHash()
 * @method void setPasswordHash(?string $passwordHash)
 * @method ?string getExpireDate()
 * @method void setExpireDate(?string $expireDate)
 * @method ?string getAssetIds()
 * @method void setAssetIds(?string $assetIds)
 * @method ?bool getReview()
 * @method void setReview(?bool $review)
 * @method ?bool getCanComment()
 * @method void setCanComment(?bool $canComment)
 * @method ?bool getAllowOlder()
 * @method void setAllowOlder(?bool $allowOlder)
 * @method ?bool getWatermark()
 * @method void setWatermark(?bool $watermark)
 * @method ?bool getCanDownload()
 * @method void setCanDownload(?bool $canDownload)
 * @method ?bool getLatestOnly()
 * @method void setLatestOnly(?bool $latestOnly)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class ProjectLink extends Entity {
	protected ?int $projectId = null;
	protected ?string $ownerUid = null;
	protected ?string $token = null;
	protected ?string $label = null;
	protected ?string $description = null;
	protected ?string $passwordHash = null;
	protected ?string $expireDate = null;
	protected ?string $assetIds = null;
	/** Live unless paused (story 122) */
	protected ?bool $review = null;
	protected ?bool $canComment = null;
	protected ?bool $allowOlder = null;
	protected ?bool $watermark = null;
	protected ?bool $canDownload = null;
	protected ?bool $latestOnly = null;
	protected ?int $createdAt = null;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('review', 'boolean');
		$this->addType('canComment', 'boolean');
		$this->addType('allowOlder', 'boolean');
		$this->addType('watermark', 'boolean');
		$this->addType('canDownload', 'boolean');
		$this->addType('latestOnly', 'boolean');
		$this->addType('createdAt', 'integer');
	}

	/** @return ?list<int> the picked Assets, null for the whole Project */
	public function pickedAssets(): ?array {
		$ids = $this->getAssetIds();
		return $ids === null ? null : array_map('intval', json_decode($ids, true, flags: JSON_THROW_ON_ERROR));
	}
}
