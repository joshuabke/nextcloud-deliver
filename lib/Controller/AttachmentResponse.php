<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Attachment;
use OCA\Deliver\Http\RangeFileResponse;
use OCP\Files\File;

/**
 * An attached file. Pictures, video and audio open in the browser; anything
 * else is a download, so no uploaded page ever runs under Nextcloud's origin.
 */
final class AttachmentResponse {
	private const INLINE = '#^(image/(png|jpeg|gif|webp)|video/|audio/|application/pdf$)#';

	public static function of(File $file, Attachment $attachment): RangeFileResponse {
		$response = RangeFileResponse::ofFile($file, null);
		$inline = preg_match(self::INLINE, $file->getMimeType()) === 1;
		$response->addHeader('Content-Disposition', ($inline ? 'inline' : 'attachment') . "; filename*=UTF-8''" . rawurlencode($attachment->getName()));
		$response->addHeader('X-Content-Type-Options', 'nosniff');
		return $response;
	}
}
