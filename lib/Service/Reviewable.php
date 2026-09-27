<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\Node;

/** Which files in a Project folder can become Assets: video, audio and stills */
final class Reviewable {
	/** Where Comment attachments live inside a Project folder; never Assets themselves */
	public const ATTACHMENTS = '.deliver-attachments';

	/** Stills browsers show as they are (story 95) */
	public const IMAGES = '#^image/(png|jpeg|webp|gif|avif)$#';

	public static function file(Node $node): bool {
		return (preg_match('#^(video|audio)/#', $node->getMimeType()) === 1 || self::image($node->getMimeType()))
			&& !str_contains($node->getPath(), '/' . self::ATTACHMENTS . '/');
	}

	public static function image(string $mimeType): bool {
		return preg_match(self::IMAGES, $mimeType) === 1;
	}
}
