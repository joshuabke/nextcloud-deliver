<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\MuteMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
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
use OCP\IURLGenerator;

/**
 * Projects and their Assets as a Member sees them. Files is the source of
 * truth (ADR 0002): a Project is a folder, Members are whoever can reach it,
 * and every permission is read from the folder on each request.
 */
class ProjectService {
	public const TIMECODE_MODES = ['smpte', 'frames', 'seconds'];

	public function __construct(
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private CommentMapper $comments,
		private ApprovalMapper $approvals,
		private MuteMapper $mutes,
		private StackService $stacks,
		private DerivedMedia $media,
		private IRootFolder $root,
		private IURLGenerator $urls,
		private ITimeFactory $time,
		private Members $members,
		private Authors $authors,
	) {
	}

	/** @return array<int, array<string, mixed>> Projects whose folder the user can reach */
	public function listForUser(string $uid): array {
		$userFolder = $this->root->getUserFolder($uid);
		$result = [];
		// ponytail: one node lookup per Project; index by folder access if lists get long
		foreach ($this->projects->findAll() as $project) {
			$folder = $userFolder->getFirstNodeById($project->getFolderId());
			if ($folder instanceof Folder) {
				$result[] = $this->serialize($project, $folder);
			}
		}
		return $result;
	}

	/** @throws NotFoundException when the user cannot reach the folder or it is no Project */
	public function getForFolder(string $uid, int $folderId): array {
		$project = $this->projects->findByFolderId($folderId);
		if ($project === null) {
			throw new NotFoundException('Folder is not a Project');
		}
		[$project, $folder] = $this->resolve($uid, $project->getId());
		return $this->serialize($project, $folder);
	}

	/** The Project with its Asset tree, after a rescan of the folder */
	public function get(string $uid, int $id): array {
		[$project, $folder] = $this->resolve($uid, $id);
		$this->scan($project, $folder);
		return $this->serialize($project, $folder) + [
			'muted' => $this->mutes->isMuted($project->getId(), $uid),
			'assets' => $this->assetTree($project, $folder),
		];
	}

	/** Mutes or unmutes the Project's notifications for one Member (story 64) */
	public function setMuted(string $uid, int $id, bool $muted): array {
		[$project] = $this->resolve($uid, $id);
		$this->mutes->set($project->getId(), $uid, $muted);
		return ['muted' => $muted];
	}

	/**
	 * Who can be @mentioned in this Project (story 90): its Members, by name.
	 *
	 * @return list<array{id: string, name: string}>
	 */
	public function members(string $uid, int $id): array {
		[$project] = $this->resolve($uid, $id);
		$names = $this->authors->names($this->members->of($project->getFolderId()));
		asort($names, SORT_NATURAL | SORT_FLAG_CASE);
		return array_map(static fn (string $id, string $name) => ['id' => $id, 'name' => $name], array_keys($names), array_values($names));
	}

	/**
	 * Turns a folder into a Project, by default with Auto Intake (story 2).
	 *
	 * @throws NotFoundException the user cannot reach the folder
	 * @throws AccessDeniedException the folder is read-only for the user
	 * @throws ProjectConflictException it is not a folder, or it would nest Projects
	 */
	public function create(string $uid, int $folderId, bool $autoIntake = true): array {
		$userFolder = $this->root->getUserFolder($uid);
		$folder = $userFolder->getFirstNodeById($folderId);
		if ($folder === null) {
			throw new NotFoundException('Folder not found');
		}
		if (!$folder instanceof Folder) {
			throw new ProjectConflictException('Only a folder can become a Project');
		}
		$this->assertWritable($folder);
		$this->assertNotNested($userFolder, $folder);

		$project = $this->insert($uid, $folderId, $autoIntake);
		if ($autoIntake) {
			$this->scan($project, $folder);
		}
		return $this->serialize($project, $folder);
	}

	/** @throws ProjectConflictException the folder is already a Project */
	private function insert(string $uid, int $folderId, bool $autoIntake): Project {
		$project = new Project();
		$project->setFolderId($folderId);
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
	 * Assets it collected (story 3).
	 *
	 * @throws InvalidRequestException the frame rate is not positive, or the timecode mode is unknown
	 */
	public function updateSettings(
		string $uid,
		int $id,
		?bool $autoIntake = null,
		?bool $allowOlder = null,
		?int $fpsNum = null,
		?int $fpsDen = null,
		?string $timecodeMode = null,
	): array {
		[$project, $folder] = $this->resolve($uid, $id);
		$this->assertWritable($folder);
		if (($fpsNum !== null && $fpsNum < 1) || ($fpsDen !== null && $fpsDen < 1)) {
			throw new InvalidRequestException('A frame rate is a positive fraction');
		}
		if ($timecodeMode !== null && !in_array($timecodeMode, self::TIMECODE_MODES, true)) {
			throw new InvalidRequestException('Timecode is displayed as ' . implode(', ', self::TIMECODE_MODES));
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
		if ($autoIntake === true) {
			$this->scan($project, $folder);
		}
		return $this->serialize($project, $folder);
	}

	/**
	 * Enables one media file for review (story 1). It joins the nearest Project
	 * above it; without one, its own folder becomes a Project.
	 *
	 * @throws NotFoundException the user cannot reach the file
	 * @throws AccessDeniedException the file is read-only for the user
	 * @throws ProjectConflictException it is not a media file, or a new Project would nest
	 */
	public function enableFile(string $uid, int $fileId): array {
		$userFolder = $this->root->getUserFolder($uid);
		$file = $userFolder->getFirstNodeById($fileId);
		if ($file === null) {
			throw new NotFoundException('File not found');
		}
		if (!$file instanceof File || !Reviewable::file($file)) {
			throw new ProjectConflictException('Only a video or audio file can be enabled for review');
		}
		$this->assertWritable($file);
		$project = $this->findProjectForFile($userFolder, $file);
		if ($project === null) {
			$parent = $file->getParent();
			$this->assertNotNested($userFolder, $parent);
			$project = $this->insert($uid, $parent->getId(), false);
		}
		if ($this->versions->findByProjectAndFile($project->getId(), $fileId) === null) {
			$this->stacks->intake($project, $file);
		}
		return $this->assetForFile($uid, $fileId);
	}

	/**
	 * The Asset of a file, for the Files sidebar.
	 *
	 * @throws NotFoundException the file is not enabled for review
	 */
	public function assetForFile(string $uid, int $fileId): array {
		$userFolder = $this->root->getUserFolder($uid);
		$file = $userFolder->getFirstNodeById($fileId);
		if (!$file instanceof File) {
			throw new NotFoundException('File not found');
		}
		$project = $this->findProjectForFile($userFolder, $file);
		$version = $project === null ? null : $this->versions->findByProjectAndFile($project->getId(), $fileId);
		if ($project === null || $version === null) {
			throw new NotFoundException('File is not enabled for review');
		}
		return [
			'assetId' => $version->getAssetId(),
			'projectId' => $project->getId(),
			'versionId' => $version->getId(),
			'number' => $version->getNumber(),
			'state' => $version->getState(),
			'comments' => $this->comments->countByVersions([$version->getId()])[$version->getId()] ?? 0,
			'autoIntake' => (bool)$project->getAutoIntake(),
			'canWrite' => $this->canWrite($file),
		];
	}

	/**
	 * A Member's Viewer for one Version, with the permissions of the Project folder.
	 *
	 * @return array{0: Viewer, 1: Version}
	 * @throws NotFoundException the Version is gone or its Project folder is out of reach
	 */
	public function viewerForVersion(string $uid, int $versionId): array {
		$version = $this->versions->find($versionId);
		if ($version === null) {
			throw new NotFoundException('Version not found');
		}
		[$project, $folder] = $this->resolve($uid, $version->getProjectId());
		return [Viewer::member($uid, $this->canWrite($folder), (bool)$project->getAllowOlder()), $version];
	}

	/**
	 * Sets the Version Number, or clears the undo mark of an automatic stack
	 * (stories 13 and 15).
	 *
	 * @throws ProjectConflictException the Version Number is taken
	 */
	public function updateVersion(string $uid, int $versionId, ?int $number, ?bool $autoStacked): array {
		[$version, $project, $folder] = $this->writableVersion($uid, $versionId);
		if ($number !== null) {
			$version = $this->stacks->setNumber($version, $number);
		}
		if ($autoStacked === false) {
			$version = $this->stacks->acknowledge($version);
		}
		return $this->versionPayload($version, $project, $folder, $uid);
	}

	/** Stacks a Version onto another Asset by hand (story 15) */
	public function stackVersion(string $uid, int $versionId, int $assetId, ?int $number): array {
		[$version, $project, $folder] = $this->writableVersion($uid, $versionId);
		return $this->versionPayload($this->stacks->stack($version, $assetId, $number), $project, $folder, $uid);
	}

	/** Moves a Version into an Asset of its own; also undoes an automatic stack (stories 13 and 16) */
	public function unstackVersion(string $uid, int $versionId): array {
		[$version, $project, $folder] = $this->writableVersion($uid, $versionId);
		return $this->versionPayload($this->stacks->unstack($version), $project, $folder, $uid);
	}

	/**
	 * @return array{0: Version, 1: Project, 2: Folder}
	 * @throws AccessDeniedException the folder is read-only for this user
	 */
	private function writableVersion(string $uid, int $versionId): array {
		$version = $this->versions->find($versionId);
		if ($version === null) {
			throw new NotFoundException('Version not found');
		}
		[$project, $folder] = $this->resolve($uid, $version->getProjectId());
		$this->assertWritable($folder);
		return [$version, $project, $folder];
	}

	/** Regenerates the derived media of a Version (story 80) */
	public function regenerate(string $uid, int $versionId): array {
		[$version, $project, $folder] = $this->writableVersion($uid, $versionId);
		$this->media->regenerate($version->getId());
		return $this->versionPayload($this->versions->find($versionId) ?? $version, $project, $folder, $uid);
	}

	/**
	 * What the Review view needs for one Version: its Project, its Asset and
	 * the whole Version Stack, newest first.
	 *
	 * @throws NotFoundException the Version is gone or its Project folder is out of reach
	 */
	public function versionContext(string $uid, int $versionId): array {
		$version = $this->versions->find($versionId);
		if ($version === null) {
			throw new NotFoundException('Version not found');
		}
		[$project, $folder] = $this->resolve($uid, $version->getProjectId());
		$asset = $this->assets->find($version->getAssetId());
		if ($asset === null) {
			throw new NotFoundException('Asset not found');
		}
		$stack = array_reverse($this->versions->findByAsset($asset->getId()));
		$name = $this->stacks->nameOf($asset);
		return [
			'versionId' => $versionId,
			'project' => $this->serialize($project, $folder),
			'asset' => ['id' => $asset->getId(), 'name' => $name],
			'versions' => array_map(fn (Version $each) => $this->versionPayload($each, $project, $folder, $uid), $stack),
		];
	}

	/** A Member plays the original through their own WebDAV, which serves ranges */
	private function versionPayload(Version $version, Project $project, Folder $folder, string $uid): array {
		$file = $folder->getFirstNodeById($version->getFileId());
		$media = $this->urls->linkToRoute('deliver.media.show', ['id' => $version->getId(), 'kind' => '__kind__']);
		return $this->describeVersion($version, $project, $file instanceof File ? $this->davUrl($uid, $file) : null, $media)
			+ ['mimeType' => $file?->getMimeType()];
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
	 * A Version as both Review views show it, for Members and Reviewers alike.
	 *
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
			'dropFrame' => (bool)$version->getDropFrame(),
			// False when browsers cannot play the original, null while nobody knows yet
			'playable' => $version->getPlayable(),
			// Audio without a picture, once ffprobe has looked; null before
			'audioOnly' => $version->getPlayable() === null ? null : !$version->getHasVideo(),
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
	 * the files stay (story 4). A Project without Auto Intake goes with its
	 * last Asset.
	 *
	 * @throws AccessDeniedException the folder is read-only for this user
	 */
	public function disableAsset(string $uid, int $assetId): void {
		$asset = $this->assets->find($assetId);
		if ($asset === null) {
			throw new NotFoundException('Asset not found');
		}
		[$project, $folder] = $this->resolve($uid, $asset->getProjectId());
		$this->assertWritable($folder);
		foreach ($this->versions->findByAsset($assetId) as $version) {
			$this->stacks->purge($version);
		}
		if (!$project->getAutoIntake() && $this->assets->countByProject($project->getId()) === 0) {
			$this->stacks->purgeProject($project);
		}
	}

	/**
	 * Removes the Project and all its review data; the files stay (story 9).
	 *
	 * @throws AccessDeniedException the folder is read-only for this user
	 */
	public function remove(string $uid, int $id): void {
		[$project, $folder] = $this->resolve($uid, $id);
		$this->assertWritable($folder);
		$this->stacks->purgeProject($project);
	}

	/**
	 * For the periodic scan: purges Projects whose folder was deleted for good
	 * (story 11) and rescans the others. A folder in the trash is left alone,
	 * so a restore brings everything back.
	 */
	public function scanAll(): void {
		foreach ($this->projects->findAll() as $project) {
			$nodes = $this->root->getById($project->getFolderId());
			if ($nodes === []) {
				$this->stacks->purgeProject($project);
				continue;
			}
			foreach ($nodes as $folder) {
				// The owner's own copy of the folder, not a share of it and not the trash
				if ($folder instanceof Folder && preg_match('#^/[^/]+/files(/|$)#', $folder->getPath()) === 1) {
					$this->scan($project, $folder);
					break;
				}
			}
		}
	}

	/** The nearest Project at or above the file's folder, in this user's view */
	private function findProjectForFile(Folder $userFolder, File $file): ?Project {
		$top = rtrim($userFolder->getPath(), '/') . '/';
		for ($node = $file->getParent(); $node instanceof Folder; $node = $node->getParent()) {
			if (!str_starts_with(rtrim($node->getPath(), '/') . '/', $top)) {
				return null;
			}
			$project = $this->projects->findByFolderId($node->getId());
			if ($project !== null) {
				return $project;
			}
		}
		return null;
	}

	/**
	 * The Project and its folder as this user sees it; the folder's
	 * permissions are the Project's permissions (ADR 0002).
	 *
	 * @return array{0: Project, 1: Folder}
	 * @throws NotFoundException the Project is gone or the user cannot reach its folder
	 */
	public function resolve(string $uid, int $id): array {
		try {
			$project = $this->projects->find($id);
		} catch (DoesNotExistException) {
			throw new NotFoundException('Project not found');
		}
		$folder = $this->root->getUserFolder($uid)->getFirstNodeById($project->getFolderId());
		if (!$folder instanceof Folder) {
			throw new NotFoundException('Project not found');
		}
		return [$project, $folder];
	}

	public function canWrite(Node $node): bool {
		return ($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0;
	}

	/** @throws AccessDeniedException the node is read-only for this user */
	private function assertWritable(Node $node): void {
		if (!$this->canWrite($node)) {
			throw new AccessDeniedException('Write permission is required');
		}
	}

	/**
	 * A Project never contains or sits inside another Project (story 10).
	 * Checked in the requester's tree and in the owner's: a received share
	 * hides what is above it, and a share moved into a folder hides that folder
	 * from its owner.
	 */
	private function assertNotNested(Folder $userFolder, Folder $folder): void {
		$this->assertNotNestedIn($userFolder, $folder);
		$owner = $folder->getOwner();
		if ($owner === null) {
			return;
		}
		$ownerFolder = $this->root->getUserFolder($owner->getUID());
		$owned = $ownerFolder->getFirstNodeById($folder->getId());
		if ($owned instanceof Folder && $owned->getPath() !== $folder->getPath()) {
			$this->assertNotNestedIn($ownerFolder, $owned);
		}
	}

	private function assertNotNestedIn(Folder $top, Folder $folder): void {
		for ($path = dirname($folder->getPath()); str_starts_with($path, $top->getPath()); $path = dirname($path)) {
			if ($this->projects->findByFolderId($this->root->get($path)->getId()) !== null) {
				throw new ProjectConflictException('This folder is inside a Project already');
			}
		}
		$prefix = $folder->getPath() . '/';
		foreach ($this->projects->findAll() as $other) {
			$node = $top->getFirstNodeById($other->getFolderId());
			if ($node !== null && str_starts_with($node->getPath(), $prefix)) {
				throw new ProjectConflictException('This folder contains a Project already');
			}
		}
	}

	/**
	 * Brings the Project in line with its folder. With Auto Intake every
	 * video or audio file becomes an Asset; without it only the enabled files
	 * are looked at. A Version whose file is gone turns Missing, and a Missing
	 * one whose file was deleted for good is purged. Subfolders that are
	 * Projects of their own (Files does not stop a move) are skipped.
	 * ponytail: walks the whole folder on every read; rely on the listener and the periodic scan once folders get big
	 */
	private function scan(Project $project, Folder $folder): void {
		$known = [];
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			$known[$version->getFileId()] = $version;
		}
		$present = [];
		$files = $project->getAutoIntake()
			? $this->mediaFiles($folder)
			: $this->enabledFiles($folder, array_keys($known));
		foreach ($files as $file) {
			$present[$file->getId()] = true;
			if (isset($known[$file->getId()])) {
				$this->stacks->follow($known[$file->getId()], $file);
			} else {
				$this->stacks->intake($project, $file);
			}
		}
		foreach ($known as $fileId => $version) {
			if (isset($present[$fileId])) {
				continue;
			}
			if ($version->getState() === Version::STATE_READY) {
				$this->stacks->markMissing($version);
			} elseif ($this->root->getById($fileId) === []) {
				// Deleting from the trash fires no event Deliver can listen to
				$this->stacks->purge($version);
			}
		}
	}

	/**
	 * The enabled files that are still in the folder; one that moved out is not found.
	 *
	 * @param list<int> $fileIds
	 * @return \Generator<File>
	 */
	private function enabledFiles(Folder $folder, array $fileIds): \Generator {
		foreach ($fileIds as $fileId) {
			$file = $folder->getFirstNodeById($fileId);
			if ($file instanceof File) {
				yield $file;
			}
		}
	}

	/** @return \Generator<File> */
	private function mediaFiles(Folder $folder): \Generator {
		foreach ($folder->getDirectoryListing() as $node) {
			if ($node instanceof Folder) {
				if ($node->getName() !== Reviewable::ATTACHMENTS && $this->projects->findByFolderId($node->getId()) === null) {
					yield from $this->mediaFiles($node);
				}
			} elseif ($node instanceof File && Reviewable::file($node)) {
				yield $node;
			}
		}
	}

	/** @return list<array<string, mixed>> the Assets with their Version Stacks, newest Version first */
	private function assetTree(Project $project, Folder $folder): array {
		$versionsByAsset = [];
		$versionIds = [];
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			$versionsByAsset[$version->getAssetId()][] = $version;
			$versionIds[] = $version->getId();
		}
		$commentCounts = $this->comments->countByVersions($versionIds);
		$approvalCounts = $this->approvals->countByVersions($versionIds);
		$result = [];
		foreach ($this->assets->findByProject($project->getId()) as $asset) {
			$stack = $versionsByAsset[$asset->getId()] ?? [];
			if ($stack === []) {
				continue;
			}
			$versions = [];
			$path = null;
			foreach ($stack as $version) {
				$file = $folder->getFirstNodeById($version->getFileId());
				if ($file !== null && $path === null) {
					$path = ltrim(substr(dirname($file->getPath()), strlen($folder->getPath())), '/');
				}
				$versions[] = [
					'id' => $version->getId(),
					'number' => $version->getNumber(),
					'fileId' => $version->getFileId(),
					'state' => $version->getState(),
					'name' => $version->getName(),
					'mimeType' => $file?->getMimeType(),
					'size' => $file?->getSize(),
					'autoStacked' => (bool)$version->getAutoStacked(),
					'comments' => $commentCounts[$version->getId()] ?? 0,
					'approvals' => $approvalCounts[$version->getId()] ?? ['approved' => 0, 'changes' => 0],
					// Queued or running derived media, with the running job's progress
					'processing' => array_intersect(
						[$version->getProxyState(), $version->getThumbsState(), $version->getWaveformState()],
						[DerivedMedia::STATE_QUEUED, DerivedMedia::STATE_RUNNING],
					) === [] ? null : ['progress' => $this->progress($version)],
				];
			}
			$result[] = [
				'id' => $asset->getId(),
				'name' => $this->stacks->nameOf($asset),
				'path' => $path ?? '',
				'parentId' => $asset->getParentId(),
				'versions' => $versions,
			];
		}
		usort($result, static fn (array $a, array $b) => [$a['path'], $a['name']] <=> [$b['path'], $b['name']]);
		return $result;
	}

	private function serialize(Project $project, Folder $folder): array {
		return [
			'id' => $project->getId(),
			'folderId' => $project->getFolderId(),
			'name' => $folder->getName(),
			'path' => $folder->getPath(),
			'canWrite' => $this->canWrite($folder),
			'autoIntake' => (bool)$project->getAutoIntake(),
			'allowOlder' => (bool)$project->getAllowOlder(),
			'fps' => ['num' => $project->getFpsNum(), 'den' => $project->getFpsDen()],
			'timecodeMode' => $project->getTimecodeMode(),
			'createdAt' => $project->getCreatedAt(),
		];
	}
}
