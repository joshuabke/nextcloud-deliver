<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\AttachmentMapper;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\MuteMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectLinkMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\ReactionMapper;
use OCA\Deliver\Db\SeenMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IDBConnection;

/**
 * Version Stacks, and the one place where review data is deleted. A filename
 * can suggest a Stack, but Stacks are explicit rows and a rename never
 * regroups anything; an automatic stack is marked so a Member can undo it
 * (spec: Versions).
 */
class StackService {
	public function __construct(
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private CommentMapper $comments,
		private SeenMapper $seen,
		private ApprovalMapper $approvals,
		private ReactionMapper $reactions,
		private AttachmentMapper $attachments,
		private DerivedMedia $media,
		private NotificationService $notifications,
		private ReviewerMail $reviewerMail,
		private MuteMapper $mutes,
		private IRootFolder $root,
		private ITimeFactory $time,
		private IDBConnection $db,
		private AttachmentStore $attachmentFiles,
		private ProjectLinkMapper $projectLinks,
		private LinkActivityMapper $activity,
	) {
	}

	/**
	 * Registers a media file: as a new Asset, or as the next Version of the one
	 * Asset in its folder that its name points at. A file is one Version at
	 * most, so a file already enabled stays where it is (ADR 0009).
	 *
	 * @param ?Project $project null for No Project
	 * @param ?string $enabledBy the Member who enabled it; null for Auto Intake
	 */
	public function intake(?Project $project, File $file, ?string $enabledBy = null): Version {
		$known = $this->versions->findByFile($file->getId());
		if ($known !== null) {
			return $known;
		}
		$suggestion = VersionNaming::parse($file->getName());
		$target = $suggestion === null ? null : $this->onlyCandidate($project, $file, $suggestion['base'], $enabledBy);
		return $this->register($project, $file, $suggestion['number'] ?? 1, $target, $enabledBy);
	}

	/**
	 * The Asset in the file's folder and Project with this base name. Null
	 * when there is none, or more than one: then a Member decides (story 14).
	 */
	private function onlyCandidate(?Project $project, File $file, string $base, ?string $enabledBy): ?Asset {
		$parentId = $file->getParent()->getId();
		$found = [];
		$assets = match (true) {
			$project !== null => $this->assets->findByProject($project->getId()),
			$enabledBy !== null => $this->assets->findUnassigned($enabledBy),
			default => [],
		};
		foreach ($assets as $asset) {
			if ($asset->getParentId() === $parentId && strcasecmp($this->nameOf($asset), $base) === 0) {
				$found[] = $asset;
			}
		}
		return count($found) === 1 ? $found[0] : null;
	}

	/** A Member's name for the Asset, else the base name of its newest Version */
	public function nameOf(Asset $asset): string {
		$override = $asset->getNameOverride();
		if ($override !== null) {
			return $override;
		}
		$newest = $this->versions->findNewest($asset->getId());
		return $newest === null ? '' : VersionNaming::assetName($newest->getName());
	}

	/**
	 * Inserts the Version, and a new Asset for it unless one is given: then it
	 * is stacked automatically. When a concurrent request registered the same
	 * file first, that Version wins.
	 */
	private function register(?Project $project, File $file, int $number, ?Asset $asset, ?string $enabledBy): Version {
		$stacked = $asset !== null;
		$this->db->beginTransaction();
		try {
			if ($asset === null) {
				$asset = new Asset();
				$asset->setProjectId($project?->getId());
				$asset->setEnabledBy($enabledBy);
				$asset->setParentId($file->getParent()->getId());
				$asset = $this->assets->insert($asset);
			}
			$version = new Version();
			$version->setProjectId($asset->getProjectId());
			$version->setAssetId($asset->getId());
			$version->setFileId($file->getId());
			$version->setNumber($this->freeNumber($asset->getId(), $number));
			$version->setName($file->getName());
			$version->setAutoStacked($stacked);
			$version->setCreatedAt($this->time->getTime());
			$version = $this->versions->insert($version);
			$this->db->commit();
			$this->media->queue($version->getId());
			$this->notifications->versionArrived($version);
			$this->reviewerMail->versionArrived($version);
			return $version;
		} catch (DbException $e) {
			$this->db->rollBack();
			$known = $this->versions->findByFile($file->getId());
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION || $known === null) {
				throw $e;
			}
			return $known;
		}
	}

	/** The wanted Version Number, or the next free one when it is taken */
	private function freeNumber(int $assetId, int $wanted): int {
		$taken = array_map(
			static fn (Version $version) => $version->getNumber(),
			$this->versions->findByAsset($assetId),
		);
		$number = max($wanted, 1);
		while (in_array($number, $taken, true)) {
			$number++;
		}
		return $number;
	}

	/**
	 * Moves a Version onto another Asset (story 15), and so into that Asset's
	 * Project: a Version Stack never spans Projects (ADR 0009). The Asset it
	 * leaves is deleted if that was its last Version.
	 */
	public function stack(Version $version, int $assetId, ?int $number): Version {
		$target = $this->assets->find($assetId);
		if ($target === null) {
			throw new NotFoundException('Asset not found');
		}
		if ($target->getId() === $version->getAssetId()) {
			return $version;
		}
		$leaving = $version->getAssetId();
		$version->setAssetId($target->getId());
		$version->setProjectId($target->getProjectId());
		$version->setNumber($this->freeNumber($target->getId(), $number ?? $this->nextNumber($target->getId())));
		$version->setAutoStacked(false);
		$version = $this->versions->update($version);
		$this->dropIfEmpty($leaving);
		return $version;
	}

	/** Moves a Version into an Asset of its own (story 16, and the undo of story 13) */
	public function unstack(Version $version): Version {
		if (count($this->versions->findByAsset($version->getAssetId())) === 1) {
			$version->setAutoStacked(false);
			return $this->versions->update($version);
		}
		$file = $this->root->getFirstNodeById($version->getFileId());
		$leaving = $this->assets->find($version->getAssetId());
		$asset = new Asset();
		$asset->setProjectId($leaving?->getProjectId());
		$asset->setEnabledBy($leaving?->getEnabledBy());
		$asset->setParentId($file?->getParent()->getId() ?? $leaving?->getParentId() ?? 0);
		$asset = $this->assets->insert($asset);
		$version->setAssetId($asset->getId());
		$version->setAutoStacked(false);
		return $this->versions->update($version);
	}

	/** @throws ProjectConflictException the Version Number is taken in this Stack */
	public function setNumber(Version $version, int $number): Version {
		if ($number < 1) {
			throw new InvalidRequestException('A Version Number starts at one');
		}
		foreach ($this->versions->findByAsset($version->getAssetId()) as $each) {
			if ($each->getNumber() === $number && $each->getId() !== $version->getId()) {
				throw new ProjectConflictException('This Stack already has a Version ' . $number);
			}
		}
		$version->setNumber($number);
		return $this->versions->update($version);
	}

	/** Clears the undo mark once a Member has seen the automatic stack */
	public function acknowledge(Version $version): Version {
		$version->setAutoStacked(false);
		return $this->versions->update($version);
	}

	/**
	 * Puts an Asset with its Versions into a Project, or into No Project for
	 * the Member who moved it there. The files stay where they are (ADR 0009).
	 */
	public function assign(Asset $asset, ?Project $project, string $uid): Asset {
		$asset->setProjectId($project?->getId());
		if ($project === null) {
			$asset->setEnabledBy($uid);
		}
		$asset = $this->assets->update($asset);
		$this->versions->setProjectOfAsset($asset->getId(), $project?->getId());
		return $asset;
	}

	/**
	 * Looks at a Version's file wherever it lies: gone for good purges the
	 * Version, only in the trash makes it Missing, anywhere else it follows
	 * the file (stories 18 to 20). Deleting a folder from the trash fires no
	 * event per file, so this is how those Versions go.
	 */
	public function check(Version $version): void {
		$nodes = $this->root->getById($version->getFileId());
		if ($nodes === []) {
			$this->purge($version);
			return;
		}
		foreach ($nodes as $node) {
			if ($node instanceof File && preg_match('#^/[^/]+/files/#', $node->getPath()) === 1) {
				$this->follow($version, $node);
				return;
			}
		}
		$this->markMissing($version);
	}

	/**
	 * The file is still there, perhaps renamed or moved (story 20): the
	 * Version is not Missing, and its name and folder follow the file.
	 */
	public function follow(Version $version, File $file): void {
		if ($version->getState() !== Version::STATE_READY || $version->getName() !== $file->getName()) {
			$version->setState(Version::STATE_READY);
			$version->setName($file->getName());
			$this->versions->update($version);
		}
		$asset = $this->assets->find($version->getAssetId());
		$parentId = $file->getParent()->getId();
		if ($asset !== null && $asset->getParentId() !== $parentId) {
			$asset->setParentId($parentId);
			$this->assets->update($asset);
		}
	}

	/** The file went to the trash: the Version is Missing, its Comments stay (story 18) */
	public function markMissing(Version $version): void {
		if ($version->getState() === Version::STATE_MISSING) {
			return;
		}
		$version->setState(Version::STATE_MISSING);
		$this->versions->update($version);
		$this->notifications->versionMissing($version);
	}

	/**
	 * Deletes a Version with its Comments, Unseen marks, Approvals and derived media, and
	 * its Asset if that was the last Version (stories 4 and 19). The file stays.
	 */
	public function purge(Version $version): void {
		$this->media->forget($version->getId());
		$commentIds = array_map(static fn ($comment) => $comment->getId(), $this->comments->findByVersion($version->getId()));
		$this->reactions->deleteByComments($commentIds);
		$this->attachments->deleteByComments($commentIds);
		foreach ($commentIds as $commentId) {
			$this->attachmentFiles->forget($commentId);
		}
		$this->comments->deleteBy('version_id', $version->getId());
		$this->seen->deleteBy('version_id', $version->getId());
		$this->approvals->deleteBy('version_id', $version->getId());
		$assetId = $version->getAssetId();
		$this->versions->delete($version);
		$this->dropIfEmpty($assetId);
	}

	/**
	 * Removes a Project; its Assets go to No Project with all their review
	 * data, for whoever enabled each or else the Member removing it (story 9).
	 */
	public function removeProject(Project $project, string $uid): void {
		$this->assets->release($project->getId(), $uid);
		$this->versions->release($project->getId());
		$this->mutes->deleteByProject($project->getId());
		// Its Project Links go with it (ADR 0010)
		foreach ($this->projectLinks->findAllOf($project->getId()) as $link) {
			$this->activity->deleteByToken($link->getToken());
			$this->projectLinks->delete($link);
		}
		$this->projects->delete($project);
	}

	private function nextNumber(int $assetId): int {
		$numbers = array_map(
			static fn (Version $version) => $version->getNumber(),
			$this->versions->findByAsset($assetId),
		);
		return $numbers === [] ? 1 : max($numbers) + 1;
	}

	private function dropIfEmpty(int $assetId): void {
		$asset = $this->assets->find($assetId);
		if ($asset !== null && $this->versions->findByAsset($assetId) === []) {
			$this->assets->delete($asset);
		}
	}
}
