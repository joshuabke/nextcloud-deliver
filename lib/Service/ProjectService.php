<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\MuteMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\RemovedMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Constants;
use OCP\DB\Exception as DbException;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\Files\Storage\ISharedStorage;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Share\IShare;
use Psr\Log\LoggerInterface;

/**
 * Projects and their Assets as a Member sees them (ADR 0009). A Project is a
 * collection whose folder is optional; access follows each Version's file,
 * read from Files on every request, so a Project shows each person the
 * Assets whose files they can open. Assets of no Project wait under No
 * Project, id 0, for whoever enabled them.
 */
class ProjectService {
	public const TIMECODE_MODES = ['smpte', 'frames', 'seconds'];
	/** No Project's id, in the API and among the mutes */
	public const NONE = 0;

	public function __construct(
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private CommentMapper $comments,
		private ApprovalMapper $approvals,
		private MuteMapper $mutes,
		private RemovedMapper $removed,
		private StackService $stacks,
		private DerivedMedia $media,
		private IRootFolder $root,
		private IURLGenerator $urls,
		private ITimeFactory $time,
		private Members $members,
		private Authors $authors,
		private Ffmpeg $ffmpeg,
		private PipelineSettings $settings,
		private NotificationService $notifications,
		private IL10N $l,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * The Projects a Member can see: a Folder Project whose folder they reach,
	 * one they made, or one with a file they can open; and No Project when it
	 * holds something of theirs.
	 *
	 * @return list<array<string, mixed>>
	 */
	public function listForUser(string $uid): array {
		$home = $this->root->getUserFolder($uid);
		$result = [];
		// ponytail: opens every Version's file per Project; index access if lists get long
		foreach ($this->projects->findAll() as $project) {
			// Listed under Deleted Projects instead (ADR 0015)
			if ($project->isDeleted()) {
				continue;
			}
			$folder = $this->folderOf($project, $home);
			$stacks = $this->visibleStacks($project, $uid, $home);
			if ($folder === null && $stacks[0] === [] && $project->getOwnerUid() !== $uid) {
				continue;
			}
			$result[] = $this->serialize($project, $folder, $uid) + [
				'muted' => $this->mutes->isMuted($project->getId(), $uid),
				'activity' => $this->activity($project, $stacks, $uid),
			];
		}
		$none = $this->visibleStacks(null, $uid, $home);
		if ($none[0] !== []) {
			$result[] = $this->serializeNone() + [
				'muted' => $this->mutes->isMuted(self::NONE, $uid),
				'activity' => $this->activity(null, $none, $uid),
			];
		}
		return $result;
	}

	/** @throws NotFoundException when the user cannot reach the folder or it is no Folder Project */
	public function getForFolder(string $uid, int $folderId): array {
		$project = $this->projects->findByFolderId($folderId);
		if ($project === null || $project->isDeleted()) {
			throw new NotFoundException('Folder is not a Project');
		}
		$folder = $this->folderOf($project, $this->root->getUserFolder($uid)) ?? throw new NotFoundException('Folder is not a Project');
		return $this->serialize($project, $folder, $uid);
	}

	/**
	 * The Project with the Assets this Member can open, after Auto Intake
	 * looked at its folder and its Missing Versions were looked at again:
	 * deleting from the trash fires no event Deliver can listen to.
	 */
	public function get(string $uid, int $id): array {
		$home = $this->root->getUserFolder($uid);
		if ($id === self::NONE) {
			$this->settleMissing($this->versions->findByAssets(array_map(static fn (Asset $asset) => $asset->getId(), $this->assets->findUnassigned($uid))));
			$stacks = $this->visibleStacks(null, $uid, $home);
			return $this->serializeNone() + [
				'muted' => $this->mutes->isMuted(self::NONE, $uid),
				'davHome' => $this->davHome($uid),
				'assets' => $this->assetTree($stacks, null, $home, $uid),
				'notEnabled' => [],
			];
		}
		[$project, $folder] = $this->visible($uid, $id);
		if ($folder !== null && $project->getAutoIntake()) {
			$this->intakeFolder($project, $folder);
		}
		$this->settleMissing($this->versions->findByProject($project->getId()));
		$stacks = $this->visibleStacks($project, $uid, $home);
		return $this->serialize($project, $folder, $uid) + [
			'muted' => $this->mutes->isMuted($project->getId(), $uid),
			'davHome' => $this->davHome($uid),
			'assets' => $this->assetTree($stacks, $folder, $home, $uid),
			// Shown greyed out under the Assets, to add one by one
			'notEnabled' => $folder === null ? [] : array_map(static fn (File $file) => [
				'fileId' => $file->getId(),
				'name' => $file->getName(),
				'path' => ltrim(substr(dirname($file->getPath()), strlen($folder->getPath())), '/'),
				'mimeType' => $file->getMimetype(),
				'canWrite' => self::canWrite($file),
			], $this->looseFiles($project, $folder)),
		];
	}

	/** @param Version[] $versions whose Missing ones are restored, or purged when their file is gone for good */
	private function settleMissing(array $versions): void {
		foreach ($versions as $version) {
			if ($version->getState() !== Version::STATE_READY) {
				$this->stacks->check($version);
			}
		}
	}

	/** Mutes or unmutes a Project's notifications, or No Project's, for one Member (story 64) */
	public function setMuted(string $uid, int $id, bool $muted): array {
		if ($id !== self::NONE) {
			$this->visible($uid, $id);
		}
		$this->mutes->set($id, $uid, $muted);
		return ['muted' => $muted];
	}

	/**
	 * Who can be @mentioned on a Version (story 90): whoever can open its file, by name.
	 *
	 * @return list<array{id: string, name: string}>
	 */
	public function members(string $uid, int $versionId): array {
		[$version] = $this->reachVersion($uid, $versionId);
		$names = $this->authors->names($this->members->of($version->getFileId()));
		asort($names, SORT_NATURAL | SORT_FLAG_CASE);
		return array_map(static fn (string $id, string $name) => ['id' => $id, 'name' => $name], array_keys($names), array_values($names));
	}

	/**
	 * Turns a folder into a Folder Project, by default with Auto Intake (story 2).
	 *
	 * @throws NotFoundException the user cannot reach the folder
	 * @throws AccessDeniedException the folder is read-only for the user
	 * @throws ProjectConflictException it is not a folder, or Folder Projects would nest
	 */
	public function create(string $uid, int $folderId, bool $autoIntake = true): array {
		$home = $this->root->getUserFolder($uid);
		$folder = $home->getFirstNodeById($folderId) ?? throw new NotFoundException('Folder not found');
		if (!$folder instanceof Folder) {
			throw new ProjectConflictException('Only a folder can become a Folder Project');
		}
		$this->assertWritable($folder);
		$deleted = $this->projects->findByFolderId($folderId);
		if ($deleted?->isDeleted() === true) {
			throw $this->deletedConflict($deleted, $uid, $this->l->t('This folder is a Project already'));
		}
		$this->assertNotNested($uid, $folder);

		$project = $this->insert($uid, $folderId, $folder->getName(), $autoIntake);
		$this->takeFromNoProject($project, $folder, $uid);
		if ($autoIntake) {
			$this->intakeFolder($project, $folder);
		}
		return $this->serialize($project, $folder, $uid);
	}

	/** Assets of No Project with a file in the folder join the Folder Project it becomes, with their review data */
	private function takeFromNoProject(Project $project, Folder $folder, string $uid): void {
		$fileIds = array_map(static fn (File $file) => $file->getId(), iterator_to_array($this->mediaFiles($folder), false));
		$assetIds = array_unique(array_map(static fn (Version $version) => $version->getAssetId(), $this->versions->findByFiles($fileIds)));
		foreach ($assetIds as $assetId) {
			$asset = $this->assets->find($assetId);
			if ($asset !== null && $asset->getProjectId() === null) {
				$this->stacks->assign($asset, $project, $uid);
			}
		}
	}

	/**
	 * A Project by name, which collects files from anywhere (story 98).
	 *
	 * @throws InvalidRequestException no name
	 */
	public function createNamed(string $uid, string $name): array {
		$name = trim($name);
		if ($name === '' || mb_strlen($name) > 255) {
			throw new InvalidRequestException('A Project needs a name of up to 255 characters');
		}
		return $this->serialize($this->insert($uid, null, $name, false), null, $uid);
	}

	/** @throws ProjectConflictException the folder is already a Project */
	private function insert(string $uid, ?int $folderId, string $name, bool $autoIntake): Project {
		$project = new Project();
		$project->setFolderId($folderId);
		$project->setName($name);
		$project->setOwnerUid($uid);
		$project->setAutoIntake($autoIntake);
		$project->setCreatedAt($this->time->getTime());
		try {
			return $this->projects->insert($project);
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			throw new ProjectConflictException('This folder is already a Project');
		}
	}

	/**
	 * Changes the settings that are given. Switching Auto Intake off keeps the
	 * Assets it collected (story 3); only a Folder Project has it, and only a
	 * Project without a folder takes a name of its own.
	 *
	 * @throws InvalidRequestException the frame rate is not positive, the timecode mode is unknown, or the setting does not apply
	 */
	public function updateSettings(
		string $uid,
		int $id,
		?bool $autoIntake = null,
		?bool $allowOlder = null,
		?int $fpsNum = null,
		?int $fpsDen = null,
		?string $timecodeMode = null,
		?string $name = null,
	): array {
		[$project, $folder] = $this->editable($uid, $id);
		if (($fpsNum !== null && $fpsNum < 1) || ($fpsDen !== null && $fpsDen < 1)) {
			throw new InvalidRequestException('A frame rate is a positive fraction');
		}
		if ($timecodeMode !== null && !in_array($timecodeMode, self::TIMECODE_MODES, true)) {
			throw new InvalidRequestException('Timecode is displayed as ' . implode(', ', self::TIMECODE_MODES));
		}
		if ($autoIntake === true && $folder === null) {
			throw new InvalidRequestException('Only a Folder Project takes in its folder');
		}
		if ($name !== null) {
			$name = trim($name);
			if ($folder !== null || $name === '' || mb_strlen($name) > 255) {
				throw new InvalidRequestException('A Folder Project is named after its folder; any other needs a name of up to 255 characters');
			}
			$project->setName($name);
		}
		if ($autoIntake !== null) {
			$project->setAutoIntake($autoIntake);
		}
		if ($allowOlder !== null) {
			$project->setAllowOlder($allowOlder);
		}
		if ($fpsNum !== null) {
			$project->setFpsNum($fpsNum);
		}
		if ($fpsDen !== null) {
			$project->setFpsDen($fpsDen);
		}
		if ($timecodeMode !== null) {
			$project->setTimecodeMode($timecodeMode);
		}
		$project = $this->projects->update($project);
		if ($autoIntake === true && $folder !== null) {
			$this->intakeFolder($project, $folder);
		}
		return $this->serialize($project, $folder, $uid);
	}

	/**
	 * Enables one media file for review (story 1), without its folder ever
	 * becoming a Project (ADR 0009). It goes to the Project given, to No
	 * Project for 0, and otherwise to the nearest Folder Project above it,
	 * else to No Project. With an Asset given, it becomes that Asset's next
	 * Version instead, in one step (stories 17 and 131).
	 *
	 * @throws NotFoundException the user cannot reach the file, the Project or the Asset
	 * @throws AccessDeniedException the file or the Asset is read-only for the user
	 * @throws ProjectConflictException it is not a media file
	 * @throws InvalidRequestException the Asset holds another kind of media
	 */
	public function enableFile(string $uid, int $fileId, ?int $projectId = null, ?int $assetId = null): array {
		$file = $this->root->getUserFolder($uid)->getFirstNodeById($fileId) ?? throw new NotFoundException('File not found');
		if (!$file instanceof File || !Reviewable::file($file)) {
			throw new ProjectConflictException('Only a video, audio or picture file can be enabled for review');
		}
		$this->assertWritable($file);
		$this->assertNotHeld($file, $uid);
		if ($assetId !== null) {
			$asset = $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found');
			$this->assertSameKind($uid, $this->writableAsset($uid, $asset), $file);
			$this->stacks->intakeOnto($asset, $file, $uid);
			return $this->assetForFile($uid, $fileId);
		}
		$project = match (true) {
			$projectId === null => $this->projects->findAbove($file),
			$projectId === self::NONE => null,
			default => $this->visible($uid, $projectId)[0],
		};
		// Only a file not in review yet would join the Deleted Project above it; one in review stays where it is
		if ($project?->isDeleted() === true && $this->versions->findByFile($file->getId()) === null) {
			throw $this->deletedConflict($project, $uid, $this->l->t('This file is inside a Project you may not change'));
		}
		$this->stacks->intake($project, $file, $uid);
		return $this->assetForFile($uid, $fileId);
	}

	/**
	 * The Asset of a file, for the Files sidebar.
	 *
	 * @throws NotFoundException the file is not enabled for review
	 */
	public function assetForFile(string $uid, int $fileId): array {
		$file = $this->root->getUserFolder($uid)->getFirstNodeById($fileId);
		$version = $file instanceof File ? $this->versions->findByFile($fileId) : null;
		$asset = $version === null || $this->projects->isDeleted($version->getProjectId()) ? null : $this->assets->find($version->getAssetId());
		if (!$file instanceof File || $version === null || $asset === null) {
			throw new NotFoundException('File is not enabled for review');
		}
		$project = $this->projectOf($asset);
		return [
			'assetId' => $version->getAssetId(),
			'projectId' => $project?->getId() ?? self::NONE,
			'projectName' => $project === null ? null : $this->nameOf($project, $this->root->getUserFolder($uid)),
			'versionId' => $version->getId(),
			'number' => $version->getNumber(),
			'state' => $version->getState(),
			'comments' => $this->comments->countByVersions([$version->getId()])[$version->getId()] ?? 0,
			// Auto Intake holds the file while it lies in the Folder Project's folder
			'autoIntake' => $project !== null && $project->getAutoIntake() && $this->projects->findAbove($file)?->getId() === $project->getId(),
			'canWrite' => $this->canWrite($file),
			// Without ffmpeg the browser that uploaded the audio decodes its Waveform from the file it holds (ADR 0012); a WAV's comes from its PCM here
			'waveformFromBrowser' => $version->getWaveformState() === DerivedMedia::STATE_NONE
				&& str_starts_with($file->getMimeType(), 'audio/')
				&& !self::isWav($version)
				&& !$this->ffmpeg->available(),
		];
	}

	private static function isWav(Version $version): bool {
		return in_array(strtolower(pathinfo($version->getName(), PATHINFO_EXTENSION)), ['wav', 'bwf'], true);
	}

	/**
	 * Puts an Asset into a Project, or into No Project for 0, without moving
	 * a file (ADR 0009). Needs write access to the Asset's newest file.
	 *
	 * @throws NotFoundException the Asset or the Project is out of reach
	 */
	public function assign(string $uid, int $assetId, int $projectId): array {
		$asset = $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found');
		$this->writableAsset($uid, $asset);
		$project = $projectId === self::NONE ? null : $this->visible($uid, $projectId)[0];
		$asset = $this->stacks->assign($asset, $project, $uid);
		return ['id' => $asset->getId(), 'projectId' => $asset->getProjectId() ?? self::NONE];
	}

	/**
	 * A Member's Viewer for one Version, with the permissions of its file.
	 *
	 * @return array{0: Viewer, 1: Version}
	 * @throws NotFoundException the Version is gone or out of reach
	 */
	public function viewerForVersion(string $uid, int $versionId): array {
		[$version, , $canWrite] = $this->reachVersion($uid, $versionId);
		return [Viewer::member($uid, $canWrite, (bool)$this->settingsOf($version)->getAllowOlder()), $version];
	}

	/**
	 * A Version whose derived media the Member may see: not where Nextcloud
	 * hides the content of the share they reach its file through.
	 *
	 * @throws NotFoundException the Version is gone, out of reach, or its content hidden from them
	 */
	public function contentOf(string $uid, int $versionId): Version {
		[$version, $file] = $this->reachVersion($uid, $versionId);
		if ($file !== null && !self::viewable($file)) {
			throw new NotFoundException('Version not found');
		}
		return $version;
	}

	/**
	 * Sets the Version Number, or clears the undo mark of an automatic stack
	 * (stories 13 and 15).
	 *
	 * @throws ProjectConflictException the Version Number is taken
	 */
	public function updateVersion(string $uid, int $versionId, ?int $number, ?bool $autoStacked): array {
		$version = $this->writableVersion($uid, $versionId);
		if ($number !== null) {
			$version = $this->stacks->setNumber($version, $number);
		}
		if ($autoStacked === false) {
			$version = $this->stacks->acknowledge($version);
		}
		return $this->versionPayload($version, $uid);
	}

	/**
	 * Stacks a Version onto another Asset by hand (story 15), bringing it into
	 * that Asset's Project; needs write access to both files.
	 */
	public function stackVersion(string $uid, int $versionId, int $assetId, ?int $number): array {
		$version = $this->writableVersion($uid, $versionId);
		$newest = $this->writableAsset($uid, $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found'));
		$file = $this->root->getUserFolder($uid)->getFirstNodeById($version->getFileId());
		if ($file instanceof File) {
			$this->assertSameKind($uid, $newest, $file);
		}
		return $this->versionPayload($this->stacks->stack($version, $assetId, $number), $uid);
	}

	/** Moves a Version into an Asset of its own; also undoes an automatic stack (stories 13 and 16) */
	public function unstackVersion(string $uid, int $versionId): array {
		return $this->versionPayload($this->stacks->unstack($this->writableVersion($uid, $versionId)), $uid);
	}

	/**
	 * A Version this Member may see, with its file as they see it and whether
	 * they may manage it. The file decides (ADR 0009); a Missing Version, whose
	 * file is in the trash, is seen by whoever sees the rest of its Stack, or
	 * its Project.
	 *
	 * @return array{0: Version, 1: ?File, 2: bool}
	 * @throws NotFoundException the Version is gone or out of reach
	 */
	private function reachVersion(string $uid, int $versionId): array {
		$version = $this->versions->find($versionId) ?? throw new NotFoundException('Version not found');
		// Nobody opens what a Deleted Project holds (ADR 0015)
		if ($this->projects->isDeleted($version->getProjectId())) {
			throw new NotFoundException('Version not found');
		}
		$home = $this->root->getUserFolder($uid);
		$file = $home->getFirstNodeById($version->getFileId());
		if ($file instanceof File) {
			return [$version, $file, $this->canWrite($file)];
		}
		// A file that is there but not theirs stays closed; only a Missing Version has no file to ask
		if ($version->getState() === Version::STATE_READY) {
			throw new NotFoundException('Version not found');
		}
		foreach ($this->versions->findByAsset($version->getAssetId()) as $sibling) {
			$other = $home->getFirstNodeById($sibling->getFileId());
			if ($other instanceof File) {
				return [$version, null, $this->canWrite($other)];
			}
		}
		$asset = $this->assets->find($version->getAssetId()) ?? throw new NotFoundException('Version not found');
		$project = $this->projectOf($asset);
		if ($project === null) {
			if ($asset->getEnabledBy() === $uid) {
				return [$version, null, true];
			}
			throw new NotFoundException('Version not found');
		}
		$folder = $this->folderOf($project, $home);
		if ($folder !== null || $project->getOwnerUid() === $uid) {
			return [$version, null, $folder === null || $this->canWrite($folder)];
		}
		throw new NotFoundException('Version not found');
	}

	/** @throws AccessDeniedException the file is read-only for this user */
	private function writableVersion(string $uid, int $versionId): Version {
		[$version, , $canWrite] = $this->reachVersion($uid, $versionId);
		if (!$canWrite) {
			throw new AccessDeniedException('Write permission is required');
		}
		return $version;
	}

	/** @throws InvalidRequestException the file is another kind of media than the Version's */
	private function assertSameKind(string $uid, Version $version, File $file): void {
		$other = $this->root->getUserFolder($uid)->getFirstNodeById($version->getFileId());
		if ($other instanceof File && Reviewable::kind($file->getMimetype()) !== Reviewable::kind($other->getMimetype())) {
			throw new InvalidRequestException('A Version Stack holds one kind of media: video, audio or stills');
		}
	}

	/** @throws AccessDeniedException the Asset's newest file is read-only for this user */
	private function writableAsset(string $uid, Asset $asset): Version {
		$newest = $this->versions->findNewest($asset->getId()) ?? throw new NotFoundException('Asset not found');
		return $this->writableVersion($uid, $newest->getId());
	}

	/**
	 * Sets or clears an Asset's Due Date (story 93). A new date earns new reminders.
	 *
	 * @param ?string $dueDate YYYY-MM-DD, or null for none
	 * @throws InvalidRequestException not a calendar day
	 */
	public function setDueDate(string $uid, int $assetId, ?string $dueDate): array {
		$asset = $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found');
		$this->writableAsset($uid, $asset);
		if ($dueDate !== null) {
			$day = \DateTimeImmutable::createFromFormat('!Y-m-d', $dueDate);
			if ($day === false || $day->format('Y-m-d') !== $dueDate) {
				throw new InvalidRequestException('A Due Date is a day like 2026-10-31');
			}
		}
		if ($asset->getDueDate() !== $dueDate) {
			$asset->setDueDate($dueDate);
			$asset->setDueReminded(null);
			$this->assets->update($asset);
		}
		return ['id' => $asset->getId(), 'dueDate' => $asset->getDueDate()];
	}

	/** Regenerates the derived media of a Version (story 80) */
	public function regenerate(string $uid, int $versionId): array {
		$version = $this->writableVersion($uid, $versionId);
		$this->media->regenerate($version->getId());
		return $this->versionPayload($this->versions->find($versionId) ?? $version, $uid);
	}

	/** What a Member's browser decoded where the server has no ffmpeg (ADR 0003) */
	public function giveWaveform(string $uid, int $versionId, array $peaks, int $durationFrames): array {
		[$version] = $this->reachVersion($uid, $versionId);
		$this->media->acceptWaveform($version, $peaks, $durationFrames);
		return $this->versionPayload($version, $uid);
	}

	/**
	 * What the Review view needs for one Version: its Project (or No Project),
	 * its Asset and the Versions of its Stack this Member can see, newest first.
	 *
	 * @throws NotFoundException the Version is gone or out of reach
	 */
	public function versionContext(string $uid, int $versionId): array {
		[$version, , $canWrite] = $this->reachVersion($uid, $versionId);
		$asset = $this->assets->find($version->getAssetId()) ?? throw new NotFoundException('Asset not found');
		$project = $this->projectOf($asset);
		$home = $this->root->getUserFolder($uid);
		$stack = [];
		foreach (array_reverse($this->versions->findByAsset($asset->getId())) as $each) {
			try {
				$this->reachVersion($uid, $each->getId());
				$stack[] = $this->versionPayload($each, $uid);
			} catch (NotFoundException) {
				// A Version whose file this Member cannot open stays out of their Stack
			}
		}
		return [
			'versionId' => $versionId,
			'canWrite' => $canWrite,
			'project' => $project === null ? $this->serializeNone() : $this->serialize($project, $this->folderOf($project, $home), $uid),
			'asset' => ['id' => $asset->getId(), 'name' => $this->stacks->nameOf($asset), 'dueDate' => $asset->getDueDate()],
			'versions' => $stack,
		];
	}

	/** A Member plays the original through their own WebDAV, which serves ranges */
	private function versionPayload(Version $version, string $uid): array {
		$file = $this->root->getUserFolder($uid)->getFirstNodeById($version->getFileId());
		$file = $file instanceof File ? $file : null;
		$media = $this->urls->linkToRoute('deliver.media.show', ['id' => $version->getId(), 'kind' => '__kind__']);
		return $this->describeVersion($version, $this->settingsOf($version), $file === null ? null : $this->davUrl($uid, $file), $media)
			+ ['mimeType' => $file?->getMimeType(), 'canWrite' => $file !== null && $this->canWrite($file)];
	}

	/** The Member's WebDAV home, under which paths with a leading slash lie, for uploads there */
	private function davHome(string $uid): string {
		return $this->urls->getAbsoluteURL('/remote.php/dav/files/' . rawurlencode($uid));
	}

	private function davUrl(string $uid, File $file): ?string {
		$relative = $this->root->getUserFolder($uid)->getRelativePath($file->getPath());
		if ($relative === null) {
			return null;
		}
		$path = implode('/', array_map('rawurlencode', explode('/', $relative)));
		return $this->urls->getAbsoluteURL('/remote.php/dav/files/' . rawurlencode($uid) . $path);
	}

	/**
	 * The Project whose settings a Version follows, or a Project with the
	 * defaults for No Project.
	 */
	public function settingsOf(Version $version): Project {
		$asset = $this->assets->find($version->getAssetId());
		return ($asset === null ? null : $this->projectOf($asset)) ?? new Project();
	}

	/**
	 * A Version as both Review views show it, for Members and Reviewers alike.
	 *
	 * @param Project $project whose frame rate counts until the Version is probed
	 * @param ?string $url where the original plays from, if at all
	 * @param string $media the derived-media URL, with `__kind__` standing for the kind
	 * @return array<string, mixed>
	 */
	public function describeVersion(Version $version, Project $project, ?string $url, string $media): array {
		$link = static fn (string $kind, string $state) => $state === DerivedMedia::STATE_READY
			? str_replace('__kind__', $kind, $media)
			: null;
		$shortSide = $version->getWidth() && $version->getHeight() ? min($version->getWidth(), $version->getHeight()) : null;
		return [
			'id' => $version->getId(),
			'number' => $version->getNumber(),
			'fileId' => $version->getFileId(),
			'name' => $version->getName(),
			'state' => $version->getState(),
			'autoStacked' => (bool)$version->getAutoStacked(),
			// Until ffprobe has run, the Project's frame rate counts the Frames
			'fps' => [
				'num' => $version->getFpsNum() ?? $project->getFpsNum(),
				'den' => $version->getFpsDen() ?? $project->getFpsDen(),
			],
			'startFrame' => $version->getStartFrame() ?? 0,
			// Known once probed; the player uses it before the media element has loaded
			'durationFrames' => $version->getDurationFrames(),
			'dropFrame' => (bool)$version->getDropFrame(),
			// False when browsers cannot play the original, null while nobody knows yet
			'playable' => $version->getPlayable(),
			// Audio without a picture, once ffprobe has looked; null before
			'audioOnly' => $version->getPlayable() === null ? null : !$version->getHasVideo() && (bool)$version->getHasAudio(),
			// A WAV takes its markers as it is; anything else needs ffmpeg to become one
			'wavExport' => self::isWav($version) || $this->ffmpeg->available(),
			'width' => $version->getWidth(),
			'height' => $version->getHeight(),
			// The short side in pixels, as in "1080p"
			'resolution' => $shortSide,
			'url' => $url,
			'derived' => [
				'proxy' => [
					'state' => $version->getProxyState(),
					'url' => $link('proxy', $version->getProxyState()),
					'resolution' => $shortSide === null ? null : min($shortSide, $this->media->maxHeight()),
				],
				'thumbs' => [
					'state' => $version->getThumbsState(),
					'url' => $link('thumbs', $version->getThumbsState()),
					'index' => $link('thumbsIndex', $version->getThumbsState()),
				],
				'waveform' => ['state' => $version->getWaveformState(), 'url' => $link('waveform', $version->getWaveformState())],
				'progress' => $this->progress($version),
				'error' => $version->getDerivedError(),
			],
		];
	}

	/** @return ?int how far the derived media of a Version has got, in percent; null when nothing is running */
	private function progress(Version $version): ?int {
		$states = [$version->getProxyState(), $version->getThumbsState(), $version->getWaveformState()];
		return in_array(DerivedMedia::STATE_RUNNING, $states, true) ? $this->media->progress($version) : null;
	}

	/**
	 * Takes an Asset out of Deliver with its Versions and their review data;
	 * the files stay (story 4).
	 *
	 * @throws AccessDeniedException the newest file is read-only for this user
	 */
	public function disableAsset(string $uid, int $assetId): void {
		$asset = $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found');
		$this->writableAsset($uid, $asset);
		foreach ($this->versions->findByAsset($assetId) as $version) {
			// Removed, its files stay out of the Auto Intake of the Folder Project they lie in, whichever Project held them (story 132)
			$file = $this->root->getFirstNodeById($version->getFileId());
			$above = $file === null ? null : $this->projects->findAbove($file);
			if ($above !== null) {
				$this->removed->mark($above->getId(), $version->getFileId());
			}
			$this->stacks->purge($version);
		}
	}

	/**
	 * Deletes an Asset together with its files: every Version's file goes to
	 * the trash of Files, and the Asset goes with its review data at once
	 * rather than staying behind as Missing (story 141).
	 *
	 * @throws AccessDeniedException a file of it this user may not delete
	 */
	public function deleteAsset(string $uid, int $assetId): void {
		$asset = $this->assets->find($assetId) ?? throw new NotFoundException('Asset not found');
		$this->writableAsset($uid, $asset);
		$home = $this->root->getUserFolder($uid);
		$doomed = [];
		// Every file is checked before anything goes, so a refusal leaves the Asset whole
		foreach ($this->versions->findByAsset($assetId) as $version) {
			$file = $version->getState() === Version::STATE_MISSING ? null : $home->getFirstNodeById($version->getFileId());
			if ($version->getState() !== Version::STATE_MISSING && ($file === null || !$file->isDeletable())) {
				throw new AccessDeniedException('You may not delete every file of this Asset');
			}
			$doomed[] = [$version, $file];
		}
		foreach ($doomed as [$version, $file]) {
			// The file goes first, so one that cannot be deleted after all keeps its Version and review data;
			// told so, the trash marks nothing Missing and mails nobody about it
			if ($file !== null) {
				$this->stacks->deleting($file->getId());
				$file->delete();
			}
			$this->stacks->purge($version);
		}
	}

	/**
	 * Deletes a Project: it becomes a Deleted Project, whole, until it is
	 * restored or goes for good (ADR 0015). Refused while it holds an Asset
	 * the Member may not change, since its data would go with the rest.
	 *
	 * @throws AccessDeniedException the user may not change this Project, or one of its Assets
	 */
	public function delete(string $uid, int $id): void {
		[$project] = $this->editable($uid, $id);
		$refused = [];
		$unseen = 0;
		foreach ($this->assets->findByProject($id) as $asset) {
			try {
				$this->writableAsset($uid, $asset);
			} catch (AccessDeniedException) {
				$refused[] = $this->stacks->nameOf($asset);
			} catch (NotFoundException) {
				// Named only to whoever can open them (ADR 0009)
				$unseen++;
			}
		}
		if ($unseen > 0) {
			$refused[] = $this->l->n('%n Asset you cannot open', '%n Assets you cannot open', $unseen);
		}
		if ($refused !== []) {
			throw new AccessDeniedException($this->l->t('You may not change every Asset of this Project: %s. Move them to another Project or remove them first.', [implode(', ', $refused)]));
		}
		$project->setDeletedAt($this->time->getTime());
		$project->setDeletedBy($uid);
		$this->projects->update($project);
		foreach ($this->versions->findByProject($id) as $version) {
			$this->notifications->versionGone($version, array_map(static fn ($comment) => $comment->getId(), $this->comments->findByVersion($version->getId())));
		}
		foreach ($this->assets->findByProject($id) as $asset) {
			$this->notifications->assetGone($asset->getId());
		}
	}

	/**
	 * The Deleted Projects this Member may restore: those they could change (story 148)
	 *
	 * @return array{projects: list<array<string, mixed>>, days: int}
	 */
	public function listDeleted(string $uid): array {
		$home = $this->root->getUserFolder($uid);
		$days = $this->keptDays();
		$listed = [];
		foreach (array_reverse($this->projects->findDeleted()) as $project) {
			if (!$this->mayChangeDeleted($project, $home, $uid)) {
				continue;
			}
			$listed[] = [
				'id' => $project->getId(),
				'name' => $this->nameOf($project, $home),
				'deletedAt' => $project->getDeletedAt(),
				'deletedBy' => $this->authors->of($project->getDeletedBy(), null)['name'],
				'goesAt' => (int)$project->getDeletedAt() + $days * 86400,
			];
		}
		return ['projects' => $listed, 'days' => $days];
	}

	/** Brings a Deleted Project back with everything whose file is still there, its Review Links as they were */
	public function restore(string $uid, int $id): void {
		$project = $this->deletedEditable($uid, $id);
		$project->setDeletedAt(null);
		$project->setDeletedBy(null);
		$this->projects->update($project);
	}

	/** Deletes a Deleted Project for good, with all its data (story 150) */
	public function deleteForGood(string $uid, int $id): void {
		$this->stacks->deleteProject($this->deletedEditable($uid, $id));
	}

	/** Deletes for good the Deleted Projects kept for as long as the admin set (story 151) */
	public function purgeDeleted(): void {
		$until = $this->time->getTime() - $this->keptDays() * 86400;
		foreach ($this->projects->findDeleted() as $project) {
			if ((int)$project->getDeletedAt() > $until) {
				continue;
			}
			// One that fails stays for the next run, and holds up neither the others nor the scan
			try {
				$this->stacks->deleteProject($project);
			} catch (\Throwable $e) {
				$this->logger->error('Could not delete the Deleted Project ' . $project->getId() . ' for good', ['exception' => $e]);
			}
		}
	}

	private function keptDays(): int {
		return (int)$this->settings->get()['deletedDays'];
	}

	/**
	 * @throws NotFoundException no such Deleted Project, or not one the user may change
	 */
	private function deletedEditable(string $uid, int $id): Project {
		try {
			$project = $this->projects->find($id);
		} catch (DoesNotExistException) {
			throw new NotFoundException('Project not found');
		}
		// Only whoever may change it knows of it
		if (!$project->isDeleted() || !$this->mayChangeDeleted($project, $this->root->getUserFolder($uid), $uid)) {
			throw new NotFoundException('Project not found');
		}
		return $project;
	}

	/**
	 * Whoever wants a file of a Deleted Project, or its folder, back in review
	 * is offered its restore, or deleting it for good first (story 149), if
	 * they may change it; anyone else hears only what they are refused.
	 */
	private function deletedConflict(Project $project, string $uid, string $otherwise): ProjectConflictException {
		$home = $this->root->getUserFolder($uid);
		if (!$this->mayChangeDeleted($project, $home, $uid)) {
			return new ProjectConflictException($otherwise);
		}
		$name = $this->nameOf($project, $home);
		return new ProjectConflictException(
			$this->l->t('This belongs to the deleted Project "%s". Restore it, or delete it for good to start afresh.', [$name]),
			'deleted',
			['projectId' => $project->getId(), 'projectName' => $name],
		);
	}

	/** @throws ProjectConflictException a Deleted Project holds the file */
	private function assertNotHeld(File $file, string $uid): void {
		$projectId = $this->versions->findByFile($file->getId())?->getProjectId();
		if ($this->projects->isDeleted($projectId)) {
			throw $this->deletedConflict($this->projects->find((int)$projectId), $uid, $this->l->t('This file belongs to a Project you may not change'));
		}
	}

	/**
	 * For the periodic scan: Deleted Projects whose time is up go for good,
	 * Auto Intake looks at every Folder Project's
	 * folder, a Folder Project whose folder was deleted for good keeps its
	 * Assets without a folder (story 11), and every Version's file is looked
	 * at wherever it lies (stories 18 and 19).
	 */
	public function scanAll(): void {
		$this->purgeDeleted();
		foreach ($this->projects->findAll() as $project) {
			$folderId = $project->getFolderId();
			if ($folderId === null) {
				continue;
			}
			$nodes = $this->root->getById($folderId);
			if ($nodes === []) {
				$project->setFolderId(null);
				$project->setAutoIntake(false);
				$this->projects->update($project);
				continue;
			}
			foreach ($nodes as $folder) {
				// The owner's own copy of the folder, not a share of it and not the trash
				if ($folder instanceof Folder && preg_match('#^/[^/]+/files(/|$)#', $folder->getPath()) === 1) {
					if ($project->getName() !== $folder->getName()) {
						$project->setName($folder->getName());
						$this->projects->update($project);
					}
					// A Deleted Project takes nothing in (ADR 0015)
					if ($project->getAutoIntake() && !$project->isDeleted()) {
						$this->intakeFolder($project, $folder);
					}
					break;
				}
			}
		}
		foreach ($this->versions->findAll() as $version) {
			$this->stacks->check($version);
		}
	}

	/**
	 * A Project this Member can see, with its folder where they reach it.
	 *
	 * @return array{0: Project, 1: ?Folder}
	 * @throws NotFoundException no such Project, or nothing of it in reach
	 */
	public function visible(string $uid, int $id): array {
		try {
			$project = $this->projects->find($id);
		} catch (DoesNotExistException) {
			throw new NotFoundException('Project not found');
		}
		if ($project->isDeleted()) {
			throw new NotFoundException('Project not found');
		}
		$home = $this->root->getUserFolder($uid);
		$folder = $this->folderOf($project, $home);
		if ($folder === null && $project->getOwnerUid() !== $uid && $this->visibleStacks($project, $uid, $home)[0] === []) {
			throw new NotFoundException('Project not found');
		}
		return [$project, $folder];
	}

	/**
	 * A Project this Member may change: a Folder Project with write access to
	 * its folder, any other if they made it (ADR 0009).
	 *
	 * @return array{0: Project, 1: ?Folder}
	 * @throws AccessDeniedException the user may not change it
	 */
	public function editable(string $uid, int $id): array {
		[$project, $folder] = $this->visible($uid, $id);
		if (!$this->mayEdit($project, $folder, $uid)) {
			throw new AccessDeniedException('Only who made a Project, or may write to its folder, changes it');
		}
		return [$project, $folder];
	}

	/** Who may change a Deleted Project; once its folder is out of reach, as in the trash of Files, whoever deleted it */
	private function mayChangeDeleted(Project $project, Folder $home, string $uid): bool {
		$folder = $this->folderOf($project, $home);
		return $this->mayEdit($project, $folder, $uid)
			|| ($project->getFolderId() !== null && $folder === null && $project->getDeletedBy() === $uid);
	}

	private function mayEdit(Project $project, ?Folder $folder, string $uid): bool {
		return $project->getFolderId() === null ? $project->getOwnerUid() === $uid : $folder !== null && $this->canWrite($folder);
	}

	/** The Folder Project's folder as this Member reaches it; null for other Projects or out of reach */
	private function folderOf(Project $project, Folder $home): ?Folder {
		$folderId = $project->getFolderId();
		$folder = $folderId === null ? null : $home->getFirstNodeById($folderId);
		return $folder instanceof Folder ? $folder : null;
	}

	private function projectOf(Asset $asset): ?Project {
		$projectId = $asset->getProjectId();
		if ($projectId === null) {
			return null;
		}
		try {
			return $this->projects->find($projectId);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	private function nameOf(Project $project, Folder $home): string {
		return $this->folderOf($project, $home)?->getName() ?? $project->getName() ?? '';
	}

	public static function canWrite(Node $node): bool {
		return ($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0;
	}

	/** Whether the file may leave as a file: a share can allow viewing but not downloading, as Files' own view-only check reads it */
	public static function downloadable(Node $node): bool {
		return self::shareOf($node)?->canDownload() ?? true;
	}

	/** Whether its content may be seen at all: where an admin allows no viewing without download, a share without downloads hides it, as WebDAV and previews do */
	public static function viewable(Node $node): bool {
		return self::shareOf($node)?->canSeeContent() ?? true;
	}

	/** The share the user reaches the node through; null for their own files */
	private static function shareOf(Node $node): ?IShare {
		$storage = $node->getStorage();
		if (!$storage->instanceOfStorage(ISharedStorage::class)) {
			return null;
		}
		/** @var ISharedStorage $storage */
		return $storage->getShare();
	}

	/** @throws AccessDeniedException the node is read-only for this user */
	public static function assertWritable(Node $node): void {
		if (!self::canWrite($node)) {
			throw new AccessDeniedException('Write permission is required');
		}
	}

	/**
	 * A Folder Project never contains or sits inside another (story 10).
	 * Checked in the requester's tree and in the owner's: a received share
	 * hides what is above it, and a share moved into a folder hides that folder
	 * from its owner.
	 */
	private function assertNotNested(string $uid, Folder $folder): void {
		$this->assertNotNestedIn($uid, $this->root->getUserFolder($uid), $folder);
		$owner = $folder->getOwner();
		if ($owner === null) {
			return;
		}
		$ownerFolder = $this->root->getUserFolder($owner->getUID());
		$owned = $ownerFolder->getFirstNodeById($folder->getId());
		if ($owned instanceof Folder && $owned->getPath() !== $folder->getPath()) {
			$this->assertNotNestedIn($uid, $ownerFolder, $owned);
		}
	}

	private function assertNotNestedIn(string $uid, Folder $top, Folder $folder): void {
		for ($path = dirname($folder->getPath()); str_starts_with($path, $top->getPath()); $path = dirname($path)) {
			$above = $this->projects->findByFolderId($this->root->get($path)->getId());
			if ($above !== null) {
				// A Deleted Project still holds its folder, and is offered back (story 149)
				$refused = $this->l->t('This folder is inside a Project already');
				throw $above->isDeleted() ? $this->deletedConflict($above, $uid, $refused) : new ProjectConflictException($refused);
			}
		}
		$prefix = $folder->getPath() . '/';
		foreach ($this->projects->findAll() as $other) {
			$otherFolderId = $other->getFolderId();
			$node = $otherFolderId === null ? null : $top->getFirstNodeById($otherFolderId);
			if ($node !== null && str_starts_with($node->getPath(), $prefix)) {
				$refused = $this->l->t('This folder contains a Project already');
				throw $other->isDeleted() ? $this->deletedConflict($other, $uid, $refused) : new ProjectConflictException($refused);
			}
		}
	}

	/**
	 * Auto Intake: every media file in the folder that no Project holds yet
	 * becomes an Asset. Subfolders that are Folder Projects of their own are
	 * skipped. Moves, the trash and deletion are the listener's and the
	 * periodic check's.
	 * ponytail: walks the whole folder on every read; rely on the listener and the periodic scan once folders get big
	 */
	private function intakeFolder(Project $project, Folder $folder): void {
		foreach ($this->looseFiles($project, $folder, true) as $file) {
			$this->stacks->intake($project, $file);
		}
	}

	/** @return \Generator<File> */
	private function mediaFiles(Folder $folder): \Generator {
		foreach ($folder->getDirectoryListing() as $node) {
			if ($node instanceof Folder) {
				if ($this->projects->findByFolderId($node->getId()) === null) {
					yield from $this->mediaFiles($node);
				}
			} elseif ($node instanceof File && Reviewable::file($node)) {
				yield $node;
			}
		}
	}

	/**
	 * The media files under a node that no Project holds, by path. With Auto
	 * Intake on, only those a Member removed; for the intake itself, all but
	 * those.
	 *
	 * @return list<File>
	 */
	private function looseFiles(Project $project, Node $node, bool $forIntake = false): array {
		$removed = $forIntake || $project->getAutoIntake() ? array_flip($this->removed->fileIds($project->getId())) : null;
		if ($removed === [] && !$forIntake) {
			return [];
		}
		$files = match (true) {
			$node instanceof Folder => iterator_to_array($this->mediaFiles($node), false),
			$node instanceof File && Reviewable::file($node) => [$node],
			default => [],
		};
		$known = array_flip(array_map(
			static fn (Version $version) => $version->getFileId(),
			$this->versions->findByFiles(array_map(static fn (File $file) => $file->getId(), $files)),
		));
		$loose = array_values(array_filter($files, static fn (File $file) => !isset($known[$file->getId()]) && ($removed === null || isset($removed[$file->getId()]) !== $forIntake)));
		usort($loose, static fn (File $a, File $b) => strcmp($a->getPath(), $b->getPath()));
		return $loose;
	}

	/**
	 * The Version Stacks of a Project, or of a Member's No Project, as far as
	 * this Member can open their files; a Missing Version comes along with
	 * the rest of its Stack.
	 *
	 * @return array{0: array<int, non-empty-list<Version>>, 1: list<int>, 2: array<int, File>, 3: array<int, Version>} the Stacks by Asset id, newest Version first; all their Version ids; the files this Member opens, by Version id; each Asset's newest Version, shown or not
	 */
	private function visibleStacks(?Project $project, string $uid, Folder $home): array {
		$versions = $project === null
			? $this->versions->findByAssets(array_map(static fn (Asset $asset) => $asset->getId(), $this->assets->findUnassigned($uid)))
			: $this->versions->findByProject($project->getId());
		// Who sees the Project as a whole sees Stacks whose files are all Missing too: its folder's Members, and who made it
		$whole = $project === null || $project->getOwnerUid() === $uid || $this->folderOf($project, $home) !== null;
		$byAsset = [];
		$files = [];
		foreach ($versions as $version) {
			$file = $home->getFirstNodeById($version->getFileId());
			if ($file instanceof File) {
				$files[$version->getId()] = $file;
			}
			$byAsset[$version->getAssetId()][] = $version;
		}
		$versionsByAsset = [];
		$versionIds = [];
		foreach ($byAsset as $assetId => $stack) {
			$open = array_values(array_filter($stack, static fn (Version $version) => isset($files[$version->getId()])));
			if ($open === [] && !$whole) {
				continue;
			}
			$shown = array_values(array_filter($stack, static fn (Version $version) => isset($files[$version->getId()]) || $version->getState() !== Version::STATE_READY));
			if ($shown !== []) {
				$versionsByAsset[$assetId] = $shown;
				array_push($versionIds, ...array_map(static fn (Version $version) => $version->getId(), $shown));
			}
		}
		return [$versionsByAsset, $versionIds, $files, array_map(static fn (array $stack) => $stack[0], $byAsset)];
	}

	/**
	 * The Assets with their Version Stacks, newest Version first. A path is
	 * relative to a Folder Project's folder for files inside it, and from the
	 * Member's home with a leading slash for every other file.
	 *
	 * @param array{0: array<int, non-empty-list<Version>>, 1: list<int>, 2: array<int, File>, 3: array<int, Version>} $stacks
	 * @return list<array<string, mixed>>
	 */
	private function assetTree(array $stacks, ?Folder $folder, Folder $home, string $uid): array {
		[$versionsByAsset, $versionIds, $files, $newestByAsset] = $stacks;
		$commentCounts = $this->comments->countByVersions($versionIds);
		$approvalCounts = $this->approvals->countByVersions($versionIds);
		$unseen = $this->comments->countUnseenByVersions($versionIds, $uid);
		$latestComments = $this->comments->latestByVersions($versionIds);
		$result = [];
		foreach ($this->assets->findByIds(array_keys($versionsByAsset)) as $asset) {
			$stack = $versionsByAsset[$asset->getId()];
			$versions = [];
			$path = null;
			foreach ($stack as $version) {
				$file = $files[$version->getId()] ?? null;
				if ($file !== null && $path === null) {
					$path = $this->pathOf($file, $folder, $home);
				}
				$versions[] = [
					'id' => $version->getId(),
					'number' => $version->getNumber(),
					'fileId' => $version->getFileId(),
					'state' => $version->getState(),
					'name' => $version->getName(),
					'mimeType' => $file?->getMimeType(),
					// To download and rename the newest one through WebDAV; null while Missing, and for the older ones
					'url' => $file === null || $version !== $stack[0] ? null : $this->davUrl($uid, $file),
					'createdAt' => $version->getCreatedAt(),
					// The card's runtime, once probed
					'durationFrames' => $version->getDurationFrames(),
					'fps' => ['num' => $version->getFpsNum(), 'den' => $version->getFpsDen()],
					'autoStacked' => (bool)$version->getAutoStacked(),
					'comments' => $commentCounts[$version->getId()] ?? 0,
					'unseen' => $unseen[$version->getId()] ?? 0,
					'approvals' => $approvalCounts[$version->getId()],
					// The card scrubs through it on hover, and shows a frame of it where Nextcloud renders no still
					'playUrl' => $version->getProxyState() === DerivedMedia::STATE_READY
						? $this->urls->linkToRoute('deliver.media.show', ['id' => $version->getId(), 'kind' => 'proxy'])
						: ($file === null ? null : $this->davUrl($uid, $file)),
					// Queued or running derived media, with the running job's progress
					'processing' => array_intersect(
						[$version->getProxyState(), $version->getThumbsState(), $version->getWaveformState()],
						[DerivedMedia::STATE_QUEUED, DerivedMedia::STATE_RUNNING],
					) === [] ? null : ['progress' => $this->progress($version)],
					// Its card says so, and a Member with write access starts it again (story 140); a failed probe leaves only its error
					'processingFailed' => in_array(
						DerivedMedia::STATE_FAILED,
						[$version->getProxyState(), $version->getThumbsState(), $version->getWaveformState()],
						true,
					) || ($version->getPlayable() === null && $version->getDerivedError() !== null),
				];
			}
			$canWrite = $this->managesAsset($uid, $newestByAsset[$asset->getId()], $files);
			$result[] = [
				'id' => $asset->getId(),
				'name' => $this->stacks->nameOf($asset),
				'path' => $path ?? '',
				'parentId' => $asset->getParentId(),
				'dueDate' => $asset->getDueDate(),
				// Manage its Stack, set its Due Date, assign it: write access to its newest file
				'canWrite' => $canWrite,
				// For sorting: when its first Version arrived, and when anything last happened on it
				'createdAt' => min(array_map(static fn (Version $version) => $version->getCreatedAt(), $stack)),
				'lastActivity' => max(array_map(
					static fn (Version $version) => max($version->getCreatedAt(), $latestComments[$version->getId()] ?? 0),
					$stack,
				)),
				'versions' => $versions,
			];
		}
		usort($result, static fn (array $a, array $b) => [$a['path'], $a['name']] <=> [$b['path'], $b['name']]);
		return $result;
	}

	/**
	 * Managing an Asset takes its newest Version, as writableAsset does: a
	 * Member of an older one alone only reads it, and where the newest file is
	 * Missing, who manages the Project manages the Asset, as in its own view.
	 *
	 * @param array<int, File> $files the files this Member opens, by Version id
	 */
	private function managesAsset(string $uid, Version $newest, array $files): bool {
		$file = $files[$newest->getId()] ?? null;
		if ($file !== null || $newest->getState() === Version::STATE_READY) {
			return $file !== null && self::canWrite($file);
		}
		try {
			return $this->reachVersion($uid, $newest->getId())[2];
		} catch (NotFoundException) {
			return false;
		}
	}

	private function pathOf(File $file, ?Folder $folder, Folder $home): string {
		$dir = dirname($file->getPath());
		if ($folder !== null && ($dir === $folder->getPath() || str_starts_with($dir, $folder->getPath() . '/'))) {
			return ltrim(substr($dir, strlen($folder->getPath())), '/');
		}
		return $home->getRelativePath($dir) ?? '/';
	}

	/**
	 * A Project's state at a glance, for its tile in the Project list: its
	 * Unseen Comments, what waits for changes, the next Due Date, the latest
	 * activity and the newest video for a picture.
	 *
	 * @param array{0: array<int, non-empty-list<Version>>, 1: list<int>, 2: array<int, File>, 3: array<int, Version>} $stacks
	 * @return array<string, mixed>
	 */
	private function activity(?Project $project, array $stacks, string $uid): array {
		[$versionsByAsset, $versionIds] = $stacks;
		$newest = array_values(array_map(static fn (array $stack) => $stack[0], $versionsByAsset));
		$approvals = $this->approvals->countByVersions(array_map(static fn (Version $version) => $version->getId(), $newest));
		$dueDates = [];
		foreach ($this->assets->findByIds(array_keys($versionsByAsset)) as $asset) {
			$dueDates[$asset->getId()] = $asset->getDueDate();
		}
		$changes = 0;
		$nextDue = null;
		foreach ($newest as $version) {
			$decided = $approvals[$version->getId()];
			$changes += $decided['changes'] > 0 ? 1 : 0;
			$due = $dueDates[$version->getAssetId()] ?? null;
			if ($due !== null && !ApprovalService::isApproved($decided) && ($nextDue === null || $due < $nextDue)) {
				$nextDue = $due;
			}
		}
		// The latest arrival first, for the tile's picture
		usort($newest, static fn (Version $a, Version $b) => $b->getCreatedAt() <=> $a->getCreatedAt());
		$videos = array_filter($newest, static fn (Version $version) => $version->getState() === Version::STATE_READY && $version->getHasVideo());
		$latestComments = $this->comments->latestByVersions($versionIds);
		return [
			'assets' => count($newest),
			'unseenComments' => array_sum($this->comments->countUnseenByVersions($versionIds, $uid)),
			'changes' => $changes,
			'nextDue' => $nextDue,
			'lastActivity' => max($project?->getCreatedAt() ?? 0, ($newest[0] ?? null)?->getCreatedAt() ?? 0, ...array_values($latestComments)),
			'still' => (array_values($videos)[0] ?? null)?->getFileId(),
		];
	}

	private function serialize(Project $project, ?Folder $folder, string $uid): array {
		return [
			'id' => $project->getId(),
			'folderId' => $project->getFolderId(),
			'name' => $folder?->getName() ?? $project->getName() ?? '',
			'path' => $folder?->getPath(),
			'none' => false,
			// Change its settings, rename or remove it (ADR 0009)
			'canWrite' => $this->mayEdit($project, $folder, $uid),
			'autoIntake' => (bool)$project->getAutoIntake(),
			'allowOlder' => (bool)$project->getAllowOlder(),
			'fps' => ['num' => $project->getFpsNum(), 'den' => $project->getFpsDen()],
			'timecodeMode' => $project->getTimecodeMode(),
			'createdAt' => $project->getCreatedAt(),
		];
	}

	/** No Project, with the defaults its Assets follow; its name is the client's to translate */
	private function serializeNone(): array {
		$defaults = new Project();
		return [
			'id' => self::NONE,
			'folderId' => null,
			'name' => '',
			'path' => null,
			'none' => true,
			'canWrite' => false,
			'autoIntake' => false,
			'allowOlder' => false,
			'fps' => ['num' => $defaults->getFpsNum(), 'den' => $defaults->getFpsDen()],
			'timecodeMode' => $defaults->getTimecodeMode(),
			'createdAt' => 0,
		];
	}
}
