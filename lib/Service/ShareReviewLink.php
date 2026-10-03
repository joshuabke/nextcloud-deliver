<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Version;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\NotFoundException;
use OCP\Share\IManager as IShareManager;
use OCP\Share\IShare;

/** A Nextcloud Share Link with review on (ADR 0004): password, expiry and revocation are the share's own */
class ShareReviewLink extends ReviewLink {
	public function __construct(
		public readonly IShare $share,
		private ShareReviewService $sharing,
		private IShareManager $shares,
	) {
	}

	public function token(): string {
		return $this->share->getToken();
	}

	public function ownerUid(): string {
		return $this->share->getSharedBy();
	}

	/** Nextcloud itself refuses an expired share before Deliver sees it */
	public function isLive(): bool {
		return $this->sharing->isReview($this->share);
	}

	public function passwordHash(): ?string {
		return $this->share->getPassword();
	}

	public function checkPassword(string $password): bool {
		return $this->shares->checkPassword($this->share, $password);
	}

	public function flags(): array {
		return $this->sharing->flags($this->share);
	}

	public function title(): string {
		try {
			return $this->share->getNode()->getName();
		} catch (NotFoundException) {
			return '';
		}
	}

	/** A Share Link's note */
	public function description(): ?string {
		$note = $this->share->getNote();
		return $note === '' ? null : $note;
	}

	public function url(): string {
		return $this->sharing->shareUrl($this->share);
	}

	protected function stacks(): array {
		return $this->sharing->assets($this->share);
	}

	protected function contains(Version $version): bool {
		return $this->sharing->containsFile($this->share, $version->getFileId());
	}

	public function originalFile(Version $version): ?File {
		$node = $this->share->getNode();
		$found = $node instanceof Folder ? $node->getFirstNodeById($version->getFileId()) : $node;
		return $found instanceof File && $found->getId() === $version->getFileId() ? $found : null;
	}

	public function directUrl(Version $version): ?string {
		return $this->sharing->mediaUrl($this->share, $version);
	}

	public function memberNodeId(): ?int {
		return $this->share->getNodeId();
	}
}
