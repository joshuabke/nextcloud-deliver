<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/** The request is valid but clashes with the current state: a nested Project, a taken Version Number, a closed older Version */
class ProjectConflictException extends \RuntimeException {
	/**
	 * @param ?string $reason what clashed, for a client that says it in its own language: name, address, identityLocked or deleted
	 * @param array<string, mixed> $details what the client needs to resolve it, such as the Deleted Project to restore
	 */
	public function __construct(
		string $message,
		public readonly ?string $reason = null,
		public readonly array $details = [],
	) {
		parent::__construct($message);
	}
}
