<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\Node;

/** Which files can become Assets: video, audio and stills */
final class Reviewable {
	/** Stills browsers show as they are (story 95) */
	public const IMAGES = '#^image/(png|jpeg|webp|gif|avif)$#';

	public static function file(Node $node): bool {
		return preg_match('#^(video|audio)/#', $node->getMimeType()) === 1 || self::image($node->getMimeType());
	}

	public static function image(string $mimeType): bool {
		return preg_match(self::IMAGES, $mimeType) === 1;
	}

	/**
	 * Video, audio or still: a Version Stack holds one kind only, whatever
	 * the container (a cut as .mov, then as .mp4), never a mix next to a cut
	 * of the same name.
	 */
	public static function kind(string $mimeType): string {
		return self::image($mimeType) ? 'image' : explode('/', $mimeType)[0];
	}
}
