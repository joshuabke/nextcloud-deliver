<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\AttachmentMapper;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\MuteMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\ReactionMapper;
use OCA\Deliver\Db\ReviewerMapper;
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
		private ReviewerMapper $reviewers,
		private DerivedMedia $media,
		private NotificationService $notifications,
		private MuteMapper $mutes,
		private IRootFolder $root,
		private ITimeFactory $time,
		private IDBConnection $db,
	) {
	}

	/**
	 * Registers a media file of the Project: as a new Asset, or as the next
	 * Version of the one Asset in its folder that its name points at.
	 */
	public function intake(Project $project, File $file): Version {
		$known = $this->versions->findByProjectAndFile($project->getId(), $file->getId());
		if ($known !== null) {
			return $known;
		}
		$suggestion = VersionNaming::parse($file->getName());
		$target = $suggestion === null ? null : $this->onlyCandidate($project, $file, $suggestion['base']);
		if ($target === null) {
			return $this->register($project, $file, $suggestion['number'] ?? 1);
		}
		return $this->register($project, $file, $suggestion['number'], $target, true);
	}

	/**
	 * The Asset in the file's folder with this base name. Null when there is
	 * none, or more than one: then a Member decides (story 14).
	 */
	private function onlyCandidate(Project $project, File $file, string $base): ?Asset {
		$parentId = $file->getParent()->getId();
		$found = [];
		foreach ($this->assets->findByProject($project->getId()) as $asset) {
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
		$stack = $this->versions->findByAsset($asset->getId());
		$newest = end($stack);
		return $newest === false ? '' : VersionNaming::assetName($newest->getName());
	}

	/**
	 * Inserts the Version, and a new Asset for it unless one is given. When a
	 * concurrent request registered the same file first, that Version wins.
	 */
	private function register(Project $project, File $file, int $number, ?Asset $asset = null, bool $stacked = false): Version {
		$this->db->beginTransaction();
		try {
			if ($asset === null) {
				$asset = new Asset();
				$asset->setProjectId($project->getId());
				$asset->setParentId($file->getParent()->getId());
				$asset = $this->assets->insert($asset);
			}
			$version = new Version();
			$version->setProjectId($project->getId());
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
			return $version;
		} catch (DbException $e) {
			$this->db->rollBack();
			$known = $this->versions->findByProjectAndFile($project->getId(), $file->getId());
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
	 * Moves a Version onto another Asset (story 15). The Asset it leaves is
	 * deleted if that was its last Version.
	 *
	 * @throws InvalidRequestException the two are not in the same Project
	 */
	public function stack(Version $version, int $assetId, ?int $number): Version {
		$target = $this->assets->find($assetId);
		if ($target === null) {
			throw new NotFoundException('Asset not found');
		}
		if ($target->getProjectId() !== $version->getProjectId()) {
			throw new InvalidRequestException('Assets of different Projects do not stack');
		}
		if ($target->getId() === $version->getAssetId()) {
			return $version;
		}
		$leaving = $version->getAssetId();
		$version->setAssetId($target->getId());
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
		$asset = new Asset();
		$asset->setProjectId($version->getProjectId());
		$asset->setParentId($file?->getParent()->getId() ?? $this->assets->find($version->getAssetId())?->getParentId() ?? 0);
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
	 * The file is still in the Project, perhaps renamed or moved (story 20):
	 * the Version is not Missing, and its name and folder follow the file.
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

	/** The file left the Project folder or went to the trash: the Version is Missing, its Comments stay (story 18) */
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
		// Attached files stay in the folder, like every file when Deliver lets go
		$this->attachments->deleteByComments($commentIds);
		$this->comments->deleteByVersion($version->getId());
		$this->seen->deleteByVersion($version->getId());
		$this->approvals->deleteByVersion($version->getId());
		$assetId = $version->getAssetId();
		$this->versions->delete($version);
		$this->dropIfEmpty($assetId);
	}

	/** Deletes the Project with everything Deliver holds for it (stories 9 and 11). The files stay. */
	public function purgeProject(Project $project): void {
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			$this->purge($version);
		}
		$this->assets->deleteByProject($project->getId());
		$this->reviewers->deleteByProject($project->getId());
		$this->mutes->deleteByProject($project->getId());
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
