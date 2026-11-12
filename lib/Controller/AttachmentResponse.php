<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Attachment;
use OCA\Deliver\Http\RangeFileResponse;
use OCP\Files\SimpleFS\ISimpleFile;

/**
 * An attached file. Pictures, video and audio open in the browser; anything
 * else is a download, so no uploaded page ever runs under Nextcloud's origin.
 */
final class AttachmentResponse {
	private const INLINE = '#^(image/(png|jpeg|gif|webp)|video/|audio/|application/pdf$)#';

	public static function of(ISimpleFile $file, Attachment $attachment): RangeFileResponse {
		$response = RangeFileResponse::ofSimpleFile($file, null);
		$inline = preg_match(self::INLINE, $file->getMimeType()) === 1;
		$response->addHeader('Content-Disposition', self::disposition($inline ? 'inline' : 'attachment', $attachment->getName()));
		$response->addHeader('X-Content-Type-Options', 'nosniff');
		return $response;
	}

	/**
	 * Content-Disposition for a file name. The plain filename is an ASCII
	 * fallback without quotes, backslashes or percent signs, since Safari shows
	 * those literally; filename* carries the real name.
	 */
	public static function disposition(string $type, string $name): string {
		$fallback = preg_replace('/[^\x20-\x7e]|["\\\\%]/u', '_', $name) ?? '';
		return $type . '; filename="' . $fallback . "\"; filename*=UTF-8''" . rawurlencode($name);
	}
}
