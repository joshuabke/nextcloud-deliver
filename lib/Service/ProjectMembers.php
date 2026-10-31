<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\MemberMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\VersionMapper;
use OCP\Constants;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Share\IManager as IShareManager;
use OCP\Share\IShare;

/**
 * A Project's Members as a Member with Manage sees and sets them (ADR 0016):
 * everyone who can open one of its files as Files grants it, people and
 * groups, each with what a Member with Manage set for them, if anything, and
 * what they have as a result. A person or group who no longer reaches any of
 * them stays listed while a Member with Manage has set something for them
 * (`reaches` false), so the entry, which keeps applying, can be seen and reset.
 */
class ProjectMembers {
	public const NEWCOMERS = [Project::NEWCOMERS_FILES, Grant::VIEW, Grant::NONE];

	public function __construct(
		private ProjectService $projects,
		private ProjectMapper $projectMapper,
		private Access $access,
		private MemberMapper $entries,
		private VersionMapper $versions,
		private IShareManager $shares,
		private IGroupManager $groups,
		private IUserManager $users,
		private IUserMountCache $mounts,
		private IRootFolder $root,
		private GroupFolders $groupFolders,
	) {
	}

	/**
	 * @return list<array<string, mixed>> the owner first, then groups, then people by name
	 * @throws NotFoundException the Project is out of reach
	 * @throws AccessDeniedException they do not manage it
	 */
	public function list(string $uid, int $id): array {
		return $this->rows($this->projects->editable($uid, $id)[0]);
	}

	/**
	 * Sets what a person or a group has in the Project, never above what the
	 * Member setting it has themselves.
	 *
	 * @return array<string, mixed> the row as it is now
	 * @throws AccessDeniedException the owner, or a switch the Member does not have themselves
	 * @throws InvalidRequestException an unknown level, a missing person or group, or Share where Files lets them reshare nothing
	 * @throws ProjectConflictException the last Member with Manage of a group folder
	 */
	public function set(string $uid, int $id, string $type, string $principal, string $level, bool $share, bool $approve): array {
		[$project] = $this->projects->editable($uid, $id);
		if (!in_array($level, Grant::LEVELS, true)) {
			throw new InvalidRequestException('A level is ' . implode(', ', Grant::LEVELS));
		}
		$grant = new Grant($level, $share, $approve);
		$row = $this->row($project, $type, $principal);
		$mine = $this->access->grantFor($uid, $project);
		// Never above their own: a switch they lack stays as it is for the other
		if (($grant->share && !$mine->share && !$row['share']) || ($grant->approve && !$mine->approve && !$row['approve'])) {
			throw new AccessDeniedException('A Member cannot give what they do not have themselves');
		}
		if ($grant->share && !$row['canShare']) {
			throw new InvalidRequestException('Files does not let them share this');
		}
		$this->store($project, $type, $principal, $grant);
		return $this->row($project, $type, $principal);
	}

	/** For the periodic scan: whoever lost access to a Project since is forgotten in it, as listing its Members does */
	public function forgetLostAll(): void {
		foreach ($this->projectMapper->findAll() as $project) {
			if (!$project->isDeleted()) {
				$this->rows($project);
			}
		}
	}

	/**
	 * Takes back what was set for them: they have what Files gives them again.
	 *
	 * @throws AccessDeniedException the owner
	 * @throws ProjectConflictException the last Member with Manage of a group folder
	 */
	public function reset(string $uid, int $id, string $type, string $principal): array {
		[$project] = $this->projects->editable($uid, $id);
		$this->row($project, $type, $principal);
		$this->store($project, $type, $principal, null);
		return $this->row($project, $type, $principal);
	}

	/**
	 * A Project's settings in one go, the newcomers setting among them: the
	 * Members' side of it is kept here, the rest by ProjectService.
	 *
	 * @return array<string, mixed> the Project as it is now
	 * @throws InvalidRequestException a setting that does not apply
	 */
	public function updateSettings(
		string $uid,
		int $id,
		?string $newcomers = null,
		?bool $autoIntake = null,
		?bool $allowOlder = null,
		?int $fpsNum = null,
		?int $fpsDen = null,
		?string $timecodeMode = null,
		?string $name = null,
		?bool $lockFiles = null,
	): array {
		if ($newcomers !== null && !in_array($newcomers, self::NEWCOMERS, true)) {
			throw new InvalidRequestException('Newcomers start with ' . implode(', ', self::NEWCOMERS));
		}
		// The rest is checked before anything is saved, so the newcomers go last: a refused setting leaves them as they were
		$settings = $this->projects->updateSettings($uid, $id, $autoIntake, $allowOlder, $fpsNum, $fpsDen, $timecodeMode, $name, $lockFiles);
		if ($newcomers === null) {
			return $settings;
		}
		$this->setNewcomers($uid, $id, $newcomers);
		return ['newcomers' => $newcomers] + $settings;
	}

	/**
	 * What someone newly given access in Files starts with. A change reaches
	 * only people who come after it: everyone who is a Member now is noted
	 * first, under the setting they have had so far, and nobody gets an entry.
	 */
	private function setNewcomers(string $uid, int $id, string $newcomers): void {
		[$project] = $this->projects->editable($uid, $id);
		if ($project->newcomersSetting() === $newcomers) {
			return;
		}
		foreach ($this->rows($project) as $row) {
			if ($row['reaches']) {
				$this->access->see($project, $row['type'], $row['id']);
			}
		}
		$project->setNewcomers($newcomers === Project::NEWCOMERS_FILES ? null : $newcomers);
		$this->projectMapper->update($project);
	}

	/** @param ?Grant $grant what to set for them; null takes back what was set */
	private function store(Project $project, string $type, string $principal, ?Grant $grant): void {
		if ($type === MemberMapper::USER && $this->access->ownerOf($project) === $principal) {
			throw new AccessDeniedException('The owner of a Project keeps Manage, Share and Approve');
		}
		// To put back if the change leaves a group folder without Manage
		$before = $this->entry($project, $type, $principal);
		if ($grant === null) {
			$this->entries->remove($project->getId(), $type, $principal);
		} else {
			$this->entries->set($project->getId(), $type, $principal, $grant);
		}
		$this->access->forget($project);
		// A group folder has no owner, so someone must stay who manages it
		if ($this->access->ownerOf($project) === null && !$this->managed($project)) {
			if ($before === null) {
				$this->entries->remove($project->getId(), $type, $principal);
			} else {
				$this->entries->set($project->getId(), $type, $principal, $before);
			}
			$this->access->forget($project);
			throw new ProjectConflictException('The last Member with Manage stays');
		}
	}

	private function managed(Project $project): bool {
		foreach ($this->rows($project) as $row) {
			if ($row['reaches'] && $row['type'] === MemberMapper::USER && $row['level'] === Grant::MANAGE) {
				return true;
			}
		}
		return false;
	}

	/**
	 * @return array<string, mixed>
	 * @throws InvalidRequestException no such person or group
	 */
	private function row(Project $project, string $type, string $principal): array {
		if (!in_array($type, [MemberMapper::USER, MemberMapper::GROUP], true)) {
			throw new InvalidRequestException('A Member is a user or a group');
		}
		foreach ($this->rows($project) as $row) {
			if ($row['type'] === $type && $row['id'] === $principal) {
				return $row;
			}
		}
		// Not one of them yet, such as someone Files will give access to later
		$exists = $type === MemberMapper::USER ? $this->users->userExists($principal) : $this->groups->groupExists($principal);
		if (!$exists) {
			throw new InvalidRequestException('No such ' . $type);
		}
		return ($type === MemberMapper::USER ? $this->userRow($project, $principal, []) : $this->groupRow($project, $principal, 0)) + ['reaches' => false];
	}

	/** @return list<array<string, mixed>> */
	private function rows(Project $project): array {
		[$users, $groupPerms] = $this->reachers($project);
		$rows = [];
		$via = [];
		foreach ($groupPerms as $gid => $permissions) {
			$group = $this->groups->get($gid);
			if ($group === null) {
				continue;
			}
			$rows[] = $this->groupRow($project, $gid, $permissions);
			foreach ($group->getUsers() as $member) {
				$via[$member->getUID()][] = ['id' => $gid, 'name' => $group->getDisplayName()];
				$users[$member->getUID()] = true;
			}
		}
		$owner = $this->access->ownerOf($project);
		foreach (array_keys($users) as $uid) {
			$uid = (string)$uid;
			if ($this->users->userExists($uid)) {
				$rows[] = $this->userRow($project, $uid, $via[$uid] ?? []);
			}
		}
		$this->access->forgetLost($project, array_map(static fn (array $row) => MemberMapper::key($row['type'], $row['id']), $rows));
		$rows = array_map(static fn (array $row) => $row + ['reaches' => true], $rows);
		// Entries of those who no longer reach it: still decisions about them, so still shown, and resettable
		$listed = array_flip(array_map(static fn (array $row) => MemberMapper::key($row['type'], $row['id']), $rows));
		foreach (array_keys(array_diff_key($this->access->entries($project), $listed)) as $key) {
			[$type, $id] = explode('/', (string)$key, 2);
			if ($type === MemberMapper::GROUP && $this->groups->groupExists($id)) {
				$rows[] = $this->groupRow($project, $id, 0) + ['reaches' => false];
			} elseif ($type === MemberMapper::USER && $this->users->userExists($id)) {
				$rows[] = $this->userRow($project, $id, []) + ['reaches' => false];
			}
		}
		usort($rows, static fn (array $a, array $b) => [$a['id'] === $owner ? 0 : 1, $a['type'] === MemberMapper::GROUP ? 0 : 1, mb_strtolower($a['name'])]
			<=> [$b['id'] === $owner ? 0 : 1, $b['type'] === MemberMapper::GROUP ? 0 : 1, mb_strtolower($b['name'])]);
		return $rows;
	}

	/**
	 * @param list<array{id: string, name: string}> $via the groups Files gives them access through
	 * @return array<string, mixed>
	 */
	private function userRow(Project $project, string $uid, array $via): array {
		$grant = $this->access->grantFor($uid, $project);
		return [
			'type' => MemberMapper::USER,
			'id' => $uid,
			'name' => $this->users->getDisplayName($uid) ?? $uid,
			'owner' => $this->access->ownerOf($project) === $uid,
			'via' => $via,
			'stored' => $this->entry($project, MemberMapper::USER, $uid)?->toArray(),
			'canShare' => $this->access->mayReshare($uid, $project),
		] + $grant->toArray();
	}

	/**
	 * @param int $permissions what the share of the group gives
	 * @return array<string, mixed>
	 */
	private function groupRow(Project $project, string $gid, int $permissions): array {
		$stored = $this->entry($project, MemberMapper::GROUP, $gid);
		$canShare = ($permissions & Constants::PERMISSION_SHARE) !== 0;
		$write = ($permissions & Constants::PERMISSION_UPDATE) !== 0;
		$grant = match (true) {
			$stored === null => $this->access->byDefault($project, MemberMapper::GROUP, $gid, $write),
			$stored->share && !$canShare => $stored->withoutShare(),
			default => $stored,
		};
		return [
			'type' => MemberMapper::GROUP,
			'id' => $gid,
			'name' => $this->groups->get($gid)?->getDisplayName() ?? $gid,
			'owner' => false,
			'via' => [],
			'stored' => $stored?->toArray(),
			'canShare' => $canShare,
		] + $grant->toArray();
	}

	private function entry(Project $project, string $type, string $id): ?Grant {
		return $this->access->entries($project)[MemberMapper::key($type, $id)] ?? null;
	}

	/**
	 * Everyone who can open one of the Project's files, as Files grants it:
	 * the people, and the groups with what their shares give.
	 * ponytail: asks Files per file outside a Folder Project's folder; fine for hundreds, batch it for thousands
	 *
	 * @return array{0: array<string, true>, 1: array<string, int>} user ids; group ids with the permissions of their shares
	 */
	private function reachers(Project $project): array {
		$users = [];
		$groups = [];
		$folderNode = null;
		foreach ($this->nodes($project) as $node) {
			if ($project->getFolderId() === $node->getId() && $node instanceof Folder) {
				$folderNode = $node;
			}
			foreach (array_keys($this->shares->getAccessList($node, true, true)['users'] ?? []) as $uid) {
				$users[(string)$uid] = true;
			}
			foreach ($this->mounts->getMountsForFileId($node->getId()) as $mount) {
				$users[$mount->getUser()->getUID()] = true;
			}
			if ($node->getOwner() !== null) {
				$users[$node->getOwner()->getUID()] = true;
			}
			// The groups of a group folder give access to everything in it
			foreach ($this->groupFolders->groupsOf($node) as $gid => $permissions) {
				$groups[$gid] = ($groups[$gid] ?? 0) | $permissions;
			}
			// A share on the node or on a folder above it
			for ($above = $node; $above instanceof Node && preg_match('#^/[^/]+/files/#', $above->getPath()) === 1; $above = $this->parent($above)) {
				$this->addGroups($groups, $this->shares->getSharesBy('', IShare::TYPE_GROUP, $above, true, -1));
			}
		}
		// Shares on what lies below the folder
		$owner = $folderNode?->getOwner()?->getUID();
		if ($folderNode !== null && $owner !== null) {
			$this->sharesBelow($owner, $folderNode, $users, $groups);
		}
		return [$users, $groups];
	}

	/**
	 * ponytail: one lookup per folder of the tree, as Files offers no deeper one; batch it if Project folders get huge
	 *
	 * @param array<string, true> $users
	 * @param array<string, int> $groups
	 */
	private function sharesBelow(string $owner, Folder $folder, array &$users, array &$groups): void {
		foreach ($this->shares->getSharesInFolder($owner, $folder, true) as $shares) {
			foreach ($shares as $share) {
				if ($share->getShareType() === IShare::TYPE_USER) {
					$users[$share->getSharedWith()] = true;
				}
			}
			$this->addGroups($groups, array_filter($shares, static fn (IShare $share) => $share->getShareType() === IShare::TYPE_GROUP));
		}
		foreach ($folder->getDirectoryListing() as $child) {
			if ($child instanceof Folder) {
				$this->sharesBelow($owner, $child, $users, $groups);
			}
		}
	}

	/**
	 * @param array<string, int> $groups
	 * @param iterable<IShare> $shares
	 */
	private function addGroups(array &$groups, iterable $shares): void {
		foreach ($shares as $share) {
			$groups[$share->getSharedWith()] = ($groups[$share->getSharedWith()] ?? 0) | $share->getPermissions();
		}
	}

	private function parent(Node $node): ?Node {
		try {
			return $node->getParent();
		} catch (NotFoundException) {
			return null;
		}
	}

	/**
	 * The owner's copy of the Project's folder and of each of its files outside it
	 *
	 * @return list<Node>
	 */
	private function nodes(Project $project): array {
		$folder = $project->getFolderId() === null ? null : $this->ownersCopy($project->getFolderId());
		$nodes = $folder === null ? [] : [$folder];
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			$file = $this->ownersCopy($version->getFileId());
			if ($file instanceof File && ($folder === null || !str_starts_with($file->getPath(), $folder->getPath() . '/'))) {
				$nodes[] = $file;
			}
		}
		return $nodes;
	}

	/** The node as its owner has it, not as a share of it, and not in the trash */
	private function ownersCopy(int $fileId): ?Node {
		$candidates = array_values(array_filter(
			$this->root->getById($fileId),
			Access::isOwnersCopy(...),
		));
		$owner = ($candidates[0] ?? null)?->getOwner()?->getUID();
		foreach ($candidates as $node) {
			if ($owner !== null && str_starts_with($node->getPath(), '/' . $owner . '/files/')) {
				return $node;
			}
		}
		return $candidates[0] ?? null;
	}
}
