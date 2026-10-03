<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\Version;
use OCP\Files\File;
use OCP\Files\NotFoundException;

/**
 * What the review page and its API need of a link, whichever kind it is: a
 * Nextcloud Share Link (ADR 0004) or a Project Link (ADR 0010). The token
 * picks the kind; everything after that is the same.
 */
abstract class ReviewLink {
	abstract public function token(): string;

	/** The Member whose Reviewers come by it */
	abstract public function ownerUid(): string;

	/** Review is on, the link is not paused and not expired */
	abstract public function isLive(): bool;

	abstract public function passwordHash(): ?string;

	abstract public function checkPassword(string $password): bool;

	/** @return array{review: bool, canComment: bool, allowOlder: bool, watermark: bool, canDownload: bool, latestOnly: bool} */
	abstract public function flags(): array;

	/** What the review page calls it: the shared file or folder, or the Project */
	abstract public function title(): string;

	/** Shown above the Assets on the review page (story 123) */
	abstract public function description(): ?string;

	/** The URL a Reviewer is sent */
	abstract public function url(): string;

	/**
	 * The Assets the link shows, each with its Versions inside it, highest
	 * Version Number first, before "only the newest Version" applies.
	 *
	 * @return array<int, array{asset: Asset, versions: non-empty-list<Version>}>
	 */
	abstract protected function stacks(): array;

	/** Whether the file of a Version lies within what the link shows */
	abstract protected function contains(Version $version): bool;

	/** The original, where the link reaches it */
	abstract public function originalFile(Version $version): ?File;

	/** A direct URL to the original that serves ranges, or null to go through Deliver */
	abstract public function directUrl(Version $version): ?string;

	/** The node a logged-in Member has to reach to be sent into the app instead, if any */
	abstract public function memberNodeId(): ?int;

	/** @return array<int, array{asset: Asset, versions: non-empty-list<Version>}> */
	final public function assets(): array {
		$stacks = $this->stacks();
		if ($this->flags()['latestOnly']) {
			foreach ($stacks as $id => $stack) {
				$stacks[$id]['versions'] = [$stack['versions'][0]];
			}
		}
		return $stacks;
	}

	/** @throws NotFoundException the Version is outside what this link shows */
	public function version(Version $version): Version {
		if (!$this->contains($version)
			|| ($this->flags()['latestOnly'] && ($this->stacks()[$version->getAssetId()]['versions'][0] ?? null)?->getId() !== $version->getId())) {
			throw new NotFoundException('Version not found');
		}
		return $version;
	}

	/** The share URL plus the Reviewer's key: whoever opens it is that Reviewer */
	public function personalLink(Reviewer $reviewer): string {
		return $this->url() . '?r=' . rawurlencode((string)$reviewer->getSecretKey());
	}
}
