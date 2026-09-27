<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\Node;

/** Which files in a Project folder can become Assets */
final class Reviewable {
	/** Where Comment attachments live inside a Project folder; never Assets themselves */
	public const ATTACHMENTS = '.deliver-attachments';

	public static function file(Node $node): bool {
		return preg_match('#^(video|audio)/#', $node->getMimeType()) === 1
			&& !str_contains($node->getPath(), '/' . self::ATTACHMENTS . '/');
	}
}
