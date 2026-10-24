<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/** The request is valid but clashes with the current state: a nested Project, a taken Version Number, a closed older Version */
class ProjectConflictException extends \RuntimeException {
	/**
	 * @param ?string $reason what clashed, for a client that says it in its own language: name, address or identityLocked
	 */
	public function __construct(
		string $message,
		public readonly ?string $reason = null,
	) {
		parent::__construct($message);
	}
}
