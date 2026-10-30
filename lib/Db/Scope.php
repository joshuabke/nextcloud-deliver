<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

/**
 * Where Reviewers and Review Links belong: to a Project, whoever invited them
 * or made the link, or to the No Project of a Member (ADR 0013, 0017).
 */
final class Scope {
	/** @param list<string> $ownerUids whose No Project, when there is no Project; empty for a Project */
	private function __construct(
		public readonly ?int $projectId,
		public readonly array $ownerUids,
	) {
	}

	public static function project(int $projectId): self {
		return new self($projectId, []);
	}

	public static function noProject(string ...$ownerUids): self {
		return new self(null, array_values($ownerUids));
	}

	/** A Project's scope, or for null the No Project of these Members; who they are matters only there */
	public static function of(?int $projectId, string ...$ownerUids): self {
		return $projectId === null ? self::noProject(...$ownerUids) : self::project($projectId);
	}

	public static function ofReviewer(Reviewer $reviewer): self {
		$owner = $reviewer->getOwnerUid();
		return self::of($reviewer->getProjectId(), ...($owner === null ? [] : [$owner]));
	}

	public function isNoProject(): bool {
		return $this->projectId === null;
	}

	/** Whether the Reviewer belongs here: to the Project, or to this Member's No Project */
	public function holds(Reviewer $reviewer): bool {
		return $reviewer->getProjectId() === $this->projectId
			&& ($this->projectId !== null || in_array($reviewer->getOwnerUid(), $this->ownerUids, true));
	}
}
