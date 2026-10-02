<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * The files of Comment attachments (story 92). They live in Deliver's app
 * data, a folder per Comment beside the derived media, so they need no
 * Project folder and nobody's quota (ADR 0009).
 */
class AttachmentStore {
	public function __construct(
		private IAppDataFactory $appDataFactory,
	) {
	}

	/** @param resource|string $content */
	public function store(int $commentId, int $attachmentId, string $name, $content): ISimpleFile {
		return $this->folder($commentId, true)->newFile(self::fileName($attachmentId, $name), $content);
	}

	/** @throws NotFoundException the file is gone */
	public function file(int $commentId, int $attachmentId, string $name): ISimpleFile {
		return $this->folder($commentId, false)->getFile(self::fileName($attachmentId, $name));
	}

	/** Deletes the attachments of a Comment, folder and all */
	public function forget(int $commentId): void {
		try {
			$this->folder($commentId, false)->delete();
		} catch (NotFoundException) {
		}
	}

	/** @throws NotFoundException no folder, and none wanted */
	private function folder(int $commentId, bool $create): ISimpleFolder {
		$appData = $this->appDataFactory->get(Application::APP_ID);
		$name = 'attachments-' . $commentId;
		try {
			return $appData->getFolder($name);
		} catch (NotFoundException $e) {
			return $create ? $appData->newFolder($name) : throw $e;
		}
	}

	/** The id keeps names apart, the extension gives the file its type */
	private static function fileName(int $attachmentId, string $name): string {
		$extension = strtolower((string)pathinfo($name, PATHINFO_EXTENSION));
		return $attachmentId . (preg_match('/^[a-z0-9]{1,10}$/', $extension) === 1 ? '.' . $extension : '');
	}
}
