<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\MemberMapper;
use OCA\Deliver\Db\Project;
use OCP\Files\IRootFolder;
use OCP\IGroupManager;
use OCP\IUserManager;

/**
 * What a person may do in a Project, in one place (ADR 0016): the owner's
 * Manage, Share and Approve, then what a Member with Manage set for them (their
 * own entry before their groups', the highest of several groups), and else what
 * Files gives (read Comment, write Manage, Approve for Manage only) or, for
 * someone who got access after the Project's newcomers setting was last
 * changed, what the Project says. Which Assets they see is not decided here:
 * that follows the files (ADR 0009).
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

	public function __construct(
		private MemberMapper $members,
		private IGroupManager $groupManager,
		private IUserManager $users,
		private IRootFolder $root,
		private GroupFolders $groupFolders,
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
		$stored = $this->stored($uid, $project);
		if ($stored !== null) {
			return $stored->share && !$reshare() ? $stored->withoutShare() : $stored;
		}
		// Noted while the setting can matter; when it is changed, everyone it did not matter for is noted then
		if ($project->getNewcomers() !== null) {
			$this->see($project, MemberMapper::USER, $uid);
		}
		return $this->byDefault($project, MemberMapper::USER, $uid, $write);
	}

	/**
	 * What someone has with nothing set for them (nor for their groups): the
	 * level the Project gives newcomers if they came after it was last
	 * changed, else what Files gives. The one place of that rule, for people
	 * and for groups.
	 */
	public function byDefault(Project $project, string $type, string $id, bool $write): Grant {
		$seen = $this->seen($project);
		$key = MemberMapper::key($type, $id);
		$newcomers = array_key_exists($key, $seen) ? $seen[$key] : $project->getNewcomers();
		return match ($newcomers) {
			Grant::NONE, Grant::VIEW => new Grant($newcomers, false, false),
			default => new Grant($write ? Grant::MANAGE : Grant::COMMENT, false, $write),
		};
	}

	/**
	 * Notes under which newcomers setting a person or group is first seen as a
	 * Member of the Project: later changes of the setting do not reach them.
	 */
	public function see(Project $project, string $type, string $id): void {
		$seen = $this->seen($project);
		if (array_key_exists(MemberMapper::key($type, $id), $seen)) {
			return;
		}
		$this->members->see($project->getId(), $type, $id, $project->getNewcomers());
		$this->seen[$project->getId()][MemberMapper::key($type, $id)] = $project->getNewcomers();
	}

	/** @return array<string, ?string> */
	private function seen(Project $project): array {
		return $this->seen[$project->getId()] ??= $this->members->seen($project->getId());
	}

	/** Whether the Project is theirs to see in Deliver: not None. Needs no file, for recipients of notifications and Mentions */
	public function sees(string $uid, ?Project $project): bool {
		if ($project === null || $this->ownerOf($project) === $uid) {
			return true;
		}
		return ($this->stored($uid, $project) ?? $this->byDefault($project, MemberMapper::USER, $uid, false))->sees();
	}

	/**
	 * What a Member with Manage set for this person: their own entry, else the
	 * highest level of their groups' with every switch any of them has.
	 */
	public function stored(string $uid, Project $project): ?Grant {
		$entries = $this->entries($project);
		if (isset($entries[MemberMapper::key(MemberMapper::USER, $uid)])) {
			return $entries[MemberMapper::key(MemberMapper::USER, $uid)];
		}
		$merged = null;
		foreach ($this->groupsOf($uid) as $gid) {
			$entry = $entries[MemberMapper::key(MemberMapper::GROUP, $gid)] ?? null;
			if ($entry !== null) {
				$merged = $merged?->merge($entry) ?? $entry;
			}
		}
		return $merged;
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
				// The owner's own copy, not a share of it and not the trash
				if (preg_match('#^/[^/]+/files(/|$)#', $node->getPath()) !== 1) {
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
