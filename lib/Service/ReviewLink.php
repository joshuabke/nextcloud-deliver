<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectLink;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IURLGenerator;
use OCP\Security\IHasher;

/**
 * A Review Link as the review page and its API see it (ADR 0011): the whole
 * Project or the picked Assets, as far as the Member who made it may share
 * their files, as a reshare would. Without a Project it shows picked Assets
 * of No Project.
 */
class ReviewLink {
	/** The switches of a link, as flags() returns them and a Member sets them */
	public const FLAGS = ['review', 'canComment', 'allowOlder', 'watermark', 'canDownload', 'latestOnly'];

	/** @var ?array<int, array{asset: Asset, versions: non-empty-list<Version>}> */
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

	/** The Member whose Reviewers come by it */
	public function ownerUid(): string {
		return $this->link->getOwnerUid();
	}

	/** Live while not paused, through its expiry day, and while its Project is there */
	public function isLive(): bool {
		$expires = $this->link->getExpireDate();
		return $this->link->getReview() === true
			&& ($expires === null || $expires >= $this->time->getDateTime()->format('Y-m-d'))
			&& ($this->link->getProjectId() === null || $this->project() !== null);
	}

	public function passwordHash(): ?string {
		return $this->link->getPasswordHash();
	}

	public function checkPassword(string $password): bool {
		$hash = $this->link->getPasswordHash();
		return $hash !== null && $this->hasher->verify($password, $hash);
	}

	/** @return array{review: bool, canComment: bool, allowOlder: bool, watermark: bool, canDownload: bool, latestOnly: bool} */
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

	/** What the review page calls it: the Project, or the label of a link to Assets of No Project */
	public function title(): string {
		$project = $this->project();
		if ($project === null) {
			$label = $this->link->getLabel();
			$first = array_values($this->stacks())[0]['versions'][0] ?? null;
			return $label ?? ($first === null ? '' : pathinfo($first->getName(), PATHINFO_FILENAME));
		}
		$folderId = $project->getFolderId();
		$folder = $folderId === null ? null : $this->root->getUserFolder($this->ownerUid())->getFirstNodeById($folderId);
		return $folder?->getName() ?? $project->getName() ?? '';
	}

	/** Shown above the Assets on the review page (story 123) */
	public function description(): ?string {
		return $this->link->getDescription();
	}

	/** The URL a Reviewer is sent */
	public function url(): string {
		return $this->urls->linkToRouteAbsolute('deliver.Public.showShare', ['token' => $this->token()]);
	}

	/** @return array<int, array{asset: Asset, versions: non-empty-list<Version>}> */
	public function assets(): array {
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
		$this->stacks();
		if (!isset($this->files[$version->getId()])
			|| ($this->flags()['latestOnly'] && ($this->stacks()[$version->getAssetId()]['versions'][0] ?? null)?->getId() !== $version->getId())) {
			throw new NotFoundException('Version not found');
		}
		return $version;
	}

	/** The original, where the link reaches it */
	public function originalFile(Version $version): ?File {
		$this->stacks();
		return $this->files[$version->getId()] ?? null;
	}

	/** The share URL plus the Reviewer's key: whoever opens it is that Reviewer */
	public function personalLink(Reviewer $reviewer): string {
		return $this->url() . '?r=' . rawurlencode((string)$reviewer->getSecretKey());
	}

	/**
	 * The Assets the link shows, each with its Versions inside it, highest
	 * Version Number first, before "only the newest Version" applies.
	 *
	 * ponytail: looks up every Version's file on each request; cache per request if Projects get big
	 *
	 * @return array<int, array{asset: Asset, versions: non-empty-list<Version>}>
	 */
	private function stacks(): array {
		if ($this->stacks !== null) {
			return $this->stacks;
		}
		$this->stacks = [];
		$picked = $this->link->pickedAssets();
		if ($this->link->getProjectId() === null) {
			$versions = $this->versions->findByAssets($picked ?? []);
		} else {
			$project = $this->project();
			$versions = $project === null ? [] : $this->versions->findByProject($project->getId());
		}
		$home = $this->root->getUserFolder($this->ownerUid());
		$byAsset = [];
		$files = [];
		foreach ($versions as $version) {
			if ($picked !== null && !in_array($version->getAssetId(), $picked, true)) {
				continue;
			}
			$file = $home->getFirstNodeById($version->getFileId());
			// What the Member may not reshare stays out, as Nextcloud would keep it out of a link of theirs
			if ($file instanceof File && $file->isShareable()) {
				$files[$version->getId()] = $file;
				$byAsset[$version->getAssetId()][] = $version;
			}
		}
		foreach ($this->assets->findByIds(array_keys($byAsset)) as $asset) {
			// An Asset of No Project leaves the link once it joins a Project
			if ($asset->getProjectId() !== $this->link->getProjectId()) {
				continue;
			}
			$this->stacks[$asset->getId()] = ['asset' => $asset, 'versions' => $byAsset[$asset->getId()]];
			foreach ($byAsset[$asset->getId()] as $version) {
				$this->files[$version->getId()] = $files[$version->getId()];
			}
		}
		return $this->stacks;
	}

	private function project(): ?Project {
		$id = $this->link->getProjectId();
		if ($id === null) {
			return null;
		}
		try {
			return $this->projects->find($id);
		} catch (DoesNotExistException) {
			return null;
		}
	}
}
