<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\MemberMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\VersionMapper;
use OCP\Constants;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IGroupManager;
use OCP\IUserManager;

/**
 * What a person may do in a Project, in one place (ADR 0016): the owner's
 * Manage, Share and Approve, then what a Member with Manage set for them (their
 * own entry before their groups', the highest of several groups, each at its
 * entry or its default), and else what Files gives (read Comment, write Manage,
 * Approve for Manage only) or, for someone who got access after the Project's
 * newcomers setting was last changed, what the Project says. Which Assets they
 * see is not decided here: that follows the files (ADR 0009).
 */
class Access {
	/** @var array<int, array<string, Grant>> what was set, by Project and MemberMapper::key(), for this request */
	private array $entries = [];
	/** @var array<int, array<string, ?string>> the newcomers setting each person or group was first seen under, by Project and MemberMapper::key() */
	private array $seen = [];
	/** @var array<string, list<string>> */
	private array $groups = [];
	/** @var array<int, ?string> */
	private array $owners = [];
	/** @var array<string, bool> */
	private array $reshares = [];

	public function __construct(
		private MemberMapper $members,
		private IGroupManager $groupManager,
		private IUserManager $users,
		private IRootFolder $root,
		private GroupFolders $groupFolders,
		private VersionMapper $versions,
	) {
	}

	/**
	 * @param ?Project $project null for No Project, where Files alone decides and links are the Member's own
	 * @param bool $write whether Files lets them write what they act on (a Version's file, a Folder Project's folder)
	 * @param \Closure(): bool $reshare whether Files lets them reshare, asked only when the answer matters
	 */
	public function grant(string $uid, ?Project $project, bool $write, \Closure $reshare): Grant {
		if ($project === null) {
			return new Grant($write ? Grant::MANAGE : Grant::COMMENT, true, $write);
		}
		if ($this->ownerOf($project) === $uid) {
			return new Grant(Grant::MANAGE, true, true);
		}
		$grant = $this->standing($uid, $project, $write);
		return $grant->share && !$reshare() ? $grant->withoutShare() : $grant;
	}

	/** What Files and the Project's Members give this person on one of its files */
	public function grantOfFile(string $uid, ?Project $project, File $file): Grant {
		return $this->grant($uid, $project, self::canWrite($file), fn () => $project !== null && $this->mayReshare($uid, $project));
	}

	/** What they may do in the Project as a whole: with Files' write access to its folder they manage it, else they comment */
	public function projectGrant(string $uid, Project $project, ?Folder $folder): Grant {
		return $this->grant($uid, $project, $folder !== null && self::canWrite($folder), fn () => $this->mayReshare($uid, $project));
	}

	/** What this person may do in the Project as a whole, for the list of its Members (ADR 0016) */
	public function grantFor(string $uid, Project $project): Grant {
		return $this->projectGrant($uid, $project, $this->folderOf($project, $this->root->getUserFolder($uid)));
	}

	/**
	 * Whether Files lets them reshare what the Project holds: its folder for a
	 * Folder Project, at least one of its files for any other (ADR 0016).
	 */
	public function mayReshare(string $uid, Project $project): bool {
		return $this->reshares[$uid . '/' . $project->getId()] ??= $this->reshareable($uid, $project);
	}

	private function reshareable(string $uid, Project $project): bool {
		$home = $this->root->getUserFolder($uid);
		if ($project->getFolderId() !== null) {
			return (($this->folderOf($project, $home)?->getPermissions() ?? 0) & Constants::PERMISSION_SHARE) !== 0;
		}
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			$file = $home->getFirstNodeById($version->getFileId());
			if ($file instanceof File && ($file->getPermissions() & Constants::PERMISSION_SHARE) !== 0) {
				return true;
			}
		}
		return false;
	}

	/** The Folder Project's folder as this Member reaches it; null for other Projects or out of reach */
	public function folderOf(Project $project, Folder $home): ?Folder {
		$folderId = $project->getFolderId();
		$folder = $folderId === null ? null : $home->getFirstNodeById($folderId);
		return $folder instanceof Folder ? $folder : null;
	}

	/** The node as its owner has it, not as a share of it and not in the trash */
	public static function isOwnersCopy(Node $node): bool {
		return preg_match('#^/[^/]+/files(/|$)#', $node->getPath()) === 1;
	}

	public static function canWrite(Node $node): bool {
		return ($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0;
	}

	/** @throws AccessDeniedException the node is read-only for this user */
	public static function assertWritable(Node $node): void {
		if (!self::canWrite($node)) {
			throw new AccessDeniedException('Write permission is required');
		}
	}

	/**
	 * What someone has with nothing set for them: the level the Project gives
	 * newcomers if they came after it was last changed, else what Files gives.
	 * The one place of that rule, for people and for groups.
	 */
	public function byDefault(Project $project, string $type, string $id, bool $write): Grant {
		$seen = $this->seen($project);
		$key = MemberMapper::key($type, $id);
		return $this->startingWith(array_key_exists($key, $seen) ? $seen[$key] : $project->getNewcomers(), $write);
	}

	/**
	 * What someone has in the Project before Files' limit on sharing: their own
	 * entry; else, across their groups that have an entry or were noted, the
	 * highest level and every switch, each group at its entry or its note,
	 * whether or not they were noted themselves, and their own default as well
	 * unless one of those groups has an entry: a group's entry may lower them,
	 * a group's note never does.
	 */
	private function standing(string $uid, Project $project, bool $write): Grant {
		$entries = $this->entries($project);
		$own = MemberMapper::key(MemberMapper::USER, $uid);
		if (isset($entries[$own])) {
			return $entries[$own];
		}
		$seen = $this->seen($project);
		$merged = null;
		$set = false;
		foreach ($this->groupsOf($uid) as $gid) {
			$key = MemberMapper::key(MemberMapper::GROUP, $gid);
			$set = $set || isset($entries[$key]);
			$grant = $entries[$key] ?? (array_key_exists($key, $seen) ? $this->startingWith($seen[$key], $write) : null);
			if ($grant !== null) {
				$merged = $merged?->merge($grant) ?? $grant;
			}
		}
		if ($set && $merged !== null) {
			return $merged;
		}
		$default = $this->byDefault($project, MemberMapper::USER, $uid, $write);
		return $merged?->merge($default) ?? $default;
	}

	private function startingWith(?string $newcomers, bool $write): Grant {
		return match ($newcomers) {
			Grant::NONE, Grant::VIEW => new Grant($newcomers, false, false),
			default => new Grant($write ? Grant::MANAGE : Grant::COMMENT, false, $write),
		};
	}

	/**
	 * Notes under which newcomers setting a person or group is first seen as a
	 * Member of the Project: later changes of the setting do not reach them.
	 * Called for everyone listed as a Member when the setting changes, so
	 * whoever came since the last change is noted under the setting they came
	 * under; nothing is written while reading.
	 */
	public function see(Project $project, string $type, string $id): void {
		$seen = $this->seen($project);
		if (array_key_exists(MemberMapper::key($type, $id), $seen)) {
			return;
		}
		$this->members->see($project->getId(), $type, $id, $project->getNewcomers());
		$this->seen[$project->getId()][MemberMapper::key($type, $id)] = $project->getNewcomers();
	}

	/**
	 * Forgets how everyone came who is not among those who reach the Project
	 * now, so that gaining access again makes them newcomers under the setting
	 * of that day. What a Member with Manage set for them stays. Nobody is
	 * forgotten while no one reaches the Project at all: all its files in the
	 * trash or storage briefly unavailable says nothing about who lost access.
	 *
	 * @param list<string> $reaching MemberMapper::key() of everyone who reaches the Project
	 */
	public function forgetLost(Project $project, array $reaching): void {
		if ($reaching === []) {
			return;
		}
		foreach (array_keys(array_diff_key($this->seen($project), array_flip($reaching))) as $key) {
			[$type, $id] = explode('/', $key, 2);
			$this->members->unsee($project->getId(), $type, $id);
			unset($this->seen[$project->getId()][$key]);
		}
	}

	/** @return array<string, ?string> */
	private function seen(Project $project): array {
		return $this->seen[$project->getId()] ??= $this->members->seen($project->getId());
	}

	/** Whether the Project is theirs to see in Deliver: not None. Needs no file, for recipients of notifications and Mentions */
	public function sees(string $uid, ?Project $project): bool {
		return $this->grant($uid, $project, false, fn () => false)->sees();
	}

	/** @return array<string, Grant> what was set for each person and group, by MemberMapper::key() */
	public function entries(Project $project): array {
		return $this->entries[$project->getId()] ??= $this->members->forProject($project->getId());
	}

	/** Forget what was read, after the entries changed */
	public function forget(Project $project): void {
		unset($this->entries[$project->getId()], $this->seen[$project->getId()]);
	}

	/**
	 * Who owns the Project: the folder's owner for a Folder Project, whoever
	 * made any other; nobody for a Folder Project in a group folder.
	 */
	public function ownerOf(Project $project): ?string {
		if (array_key_exists($project->getId(), $this->owners)) {
			return $this->owners[$project->getId()];
		}
		$owner = $project->getOwnerUid();
		if ($project->getFolderId() !== null) {
			foreach ($this->root->getById($project->getFolderId()) as $node) {
				if (!self::isOwnersCopy($node)) {
					continue;
				}
				$owner = $this->groupFolders->holds($node) ? null : ($node->getOwner()?->getUID() ?? $owner);
				break;
			}
		}
		return $this->owners[$project->getId()] = $owner;
	}

	/** @return list<string> */
	private function groupsOf(string $uid): array {
		if (!isset($this->groups[$uid])) {
			$user = $this->users->get($uid);
			$this->groups[$uid] = $user === null ? [] : array_map('strval', $this->groupManager->getUserGroupIds($user));
		}
		return $this->groups[$uid];
	}
}
