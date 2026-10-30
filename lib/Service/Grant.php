<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/** What a Member may do in a Project: an Access level and the switches Share and Approve (ADR 0016) */
final class Grant {
	public const NONE = 'none';
	public const VIEW = 'view';
	public const COMMENT = 'comment';
	public const MANAGE = 'manage';
	public const LEVELS = [self::NONE, self::VIEW, self::COMMENT, self::MANAGE];

	public readonly string $level;
	/** Review Links and Reviewers */
	public readonly bool $share;
	/** Approve a Version or request changes, from Comment up */
	public readonly bool $approve;

	public function __construct(string $level, bool $share, bool $approve) {
		$this->level = $level;
		$rank = self::rank($level);
		$this->share = $rank > 0 && $share;
		$this->approve = $rank >= 2 && $approve;
	}

	public static function rank(string $level): int {
		return (int)array_search($level, self::LEVELS, true);
	}

	public function sees(): bool {
		return $this->level !== self::NONE;
	}

	public function comments(): bool {
		return self::rank($this->level) >= 2;
	}

	public function manages(): bool {
		return $this->level === self::MANAGE;
	}

	/** @return array{level: string, share: bool, approve: bool} */
	public function toArray(): array {
		return ['level' => $this->level, 'share' => $this->share, 'approve' => $this->approve];
	}
}
