<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectLink;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IURLGenerator;
use OCP\Security\IHasher;

/**
 * A Project Link (ADR 0010): the whole Project or the picked Assets, as far
 * as the Member who made it may share their files, as a reshare would.
 */
class ProjectReviewLink extends ReviewLink {
	/** @var ?array<int, array{asset: \OCA\Deliver\Db\Asset, versions: non-empty-list<Version>}> */
	private ?array $stacks = null;
	/** @var array<int, File> per Version id, the files the link reaches */
	private array $files = [];

	public function __construct(
		public readonly ProjectLink $link,
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private IRootFolder $root,
		private IHasher $hasher,
		private IURLGenerator $urls,
		private ITimeFactory $time,
	) {
	}

	public function token(): string {
		return $this->link->getToken();
	}

	public function ownerUid(): string {
		return $this->link->getOwnerUid();
	}

	/** Live while not paused, through its expiry day, and while its Project is there */
	public function isLive(): bool {
		$expires = $this->link->getExpireDate();
		return $this->link->getReview() === true
			&& ($expires === null || $expires >= $this->time->getDateTime()->format('Y-m-d'))
			&& $this->project() !== null;
	}

	public function passwordHash(): ?string {
		return $this->link->getPasswordHash();
	}

	public function checkPassword(string $password): bool {
		$hash = $this->link->getPasswordHash();
		return $hash !== null && $this->hasher->verify($password, $hash);
	}

	public function flags(): array {
		return [
			'review' => $this->link->getReview() === true,
			'canComment' => $this->link->getCanComment() !== false,
			'allowOlder' => $this->link->getAllowOlder() === true,
			'watermark' => $this->link->getWatermark() === true,
			'canDownload' => $this->link->getCanDownload() !== false,
			'latestOnly' => $this->link->getLatestOnly() === true,
		];
	}

	public function title(): string {
		$project = $this->project();
		if ($project === null) {
			return '';
		}
		$folderId = $project->getFolderId();
		$folder = $folderId === null ? null : $this->root->getUserFolder($this->ownerUid())->getFirstNodeById($folderId);
		return $folder?->getName() ?? $project->getName() ?? '';
	}

	public function description(): ?string {
		return $this->link->getDescription();
	}

	public function url(): string {
		return $this->urls->linkToRouteAbsolute('deliver.Public.showShare', ['token' => $this->token()]);
	}

	/** ponytail: looks up every Version's file on each request; cache per request if Projects get big */
	protected function stacks(): array {
		if ($this->stacks !== null) {
			return $this->stacks;
		}
		$this->stacks = [];
		$project = $this->project();
		if ($project === null) {
			return [];
		}
		$picked = $this->link->pickedAssets();
		$home = $this->root->getUserFolder($this->ownerUid());
		$byAsset = [];
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			if ($picked !== null && !in_array($version->getAssetId(), $picked, true)) {
				continue;
			}
			$file = $home->getFirstNodeById($version->getFileId());
			// What the Member may not reshare stays out, as Nextcloud would keep it out of a link of theirs
			if ($file instanceof File && $file->isShareable()) {
				$this->files[$version->getId()] = $file;
				$byAsset[$version->getAssetId()][] = $version;
			}
		}
		foreach ($this->assets->findByIds(array_keys($byAsset)) as $asset) {
			$this->stacks[$asset->getId()] = ['asset' => $asset, 'versions' => $byAsset[$asset->getId()]];
		}
		return $this->stacks;
	}

	protected function contains(Version $version): bool {
		$this->stacks();
		return isset($this->files[$version->getId()]);
	}

	public function originalFile(Version $version): ?File {
		return $this->contains($version) ? $this->files[$version->getId()] : null;
	}

	/** The original goes through Deliver's media route, which serves ranges */
	public function directUrl(Version $version): ?string {
		return null;
	}

	/** A Member is told apart by the Version's file alone */
	public function memberNodeId(): ?int {
		return null;
	}

	private function project(): ?Project {
		try {
			return $this->projects->find($this->link->getProjectId());
		} catch (DoesNotExistException) {
			return null;
		}
	}
}
