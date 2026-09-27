<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Version;
use OCA\Deliver\Http\RangeFileResponse;
use OCA\Deliver\Service\DerivedMedia;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Response;
use OCP\Files\NotFoundException;

/** Serves derived media the same way to Members and Reviewers; only the access check before differs */
final class DerivedMediaResponse {
	public static function of(DerivedMedia $media, Version $version, string $kind, ?string $range): Response {
		try {
			return RangeFileResponse::ofSimpleFile($media->file($version, $kind), $range);
		} catch (NotFoundException) {
			// Not generated (yet); the player falls back to the original
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}
}
