<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\VersionMapper;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\IL10N;

/**
 * What Deliver does to a file from inside its lock, which WebDAV cannot pass
 * (ADR 0018): Files' write access is needed, and for a Version's file Manage in
 * its Project too (ADR 0016).
 */
class FileOperations {
	public function __construct(
		private ProjectService $projects,
		private VersionMapper $versions,
		private CommentMapper $comments,
		private FileLock $fileLock,
		private IRootFolder $root,
		private IL10N $l,
	) {
	}

	/**
	 * Renames a file in its folder (story 131) from inside Deliver's lock, which
	 * WebDAV cannot pass; Deliver follows the rename. It never replaces a file
	 * of the same name. Files' write access is needed, and for a Version's file
	 * Manage in its Project too (ADR 0016, 0018).
	 *
	 * @throws NotFoundException the user cannot reach the file, or the Project of its Version
	 * @throws AccessDeniedException the file is read-only for this user, or a Version they do not manage
	 * @throws InvalidRequestException the name is empty, too long or has a slash
	 * @throws ProjectConflictException the folder holds a file of that name
	 */
	public function rename(string $uid, int $fileId, string $name): void {
		$file = $this->root->getUserFolder($uid)->getFirstNodeById($fileId);
		if (!$file instanceof File) {
			throw new NotFoundException('File not found');
		}
		$version = $this->versions->findByFile($file->getId());
		if ($version !== null) {
			$this->projects->writableVersion($uid, $version->getId());
		}
		Access::assertWritable($file);
		$name = trim($name);
		if ($name === '' || mb_strlen($name) > 255 || str_contains($name, '/') || $name === '.' || $name === '..') {
			throw new InvalidRequestException('A file name has up to 255 characters and no slash');
		}
		$folder = $file->getParent();
		if ($folder->nodeExists($name)) {
			throw new ProjectConflictException($this->l->t('A file with this name is already in the folder.'));
		}
		try {
			$this->fileLock->inScope($file, static fn () => $file->move($folder->getPath() . '/' . $name));
		} catch (NotPermittedException) {
			throw new AccessDeniedException('You may not rename this file');
		}
	}

	/**
	 * Replaces the content of a Version's file with a file uploaded next to it
	 * (ADR 0018, spec: Delivering again): the browser or the delivering tool
	 * cannot write over a locked file, and a large file must not travel in a
	 * request body. The file keeps its id, so the Version and its Comments
	 * stay; the upload is gone once its content has been streamed over. A
	 * Version with Comments needs the confirmation first.
	 *
	 * @param int $uploadId the file id of the upload, in the folder of the Version's file
	 * @throws AccessDeniedException they do not manage the Version's Project, its file or the upload is read-only for them, or they may not delete the upload
	 * @throws NotFoundException no such Version or upload for this user
	 * @throws InvalidRequestException the upload is not a file in the Version's folder
	 * @throws ProjectConflictException the Version has Comments and nobody confirmed
	 */
	public function replace(string $uid, int $versionId, int $uploadId, bool $confirm): array {
		$version = $this->projects->writableVersion($uid, $versionId);
		$home = $this->root->getUserFolder($uid);
		$file = $home->getFirstNodeById($version->getFileId());
		$upload = $home->getFirstNodeById($uploadId) ?? throw new NotFoundException('Upload not found');
		if (!$file instanceof File || !$upload instanceof File) {
			throw new NotFoundException('File not found');
		}
		Access::assertWritable($file);
		if ($upload->getId() === $file->getId() || $upload->getParent()->getId() !== $file->getParent()->getId() || $this->versions->findByFile($upload->getId()) !== null) {
			throw new InvalidRequestException('The upload must be a file of its own next to the Version\'s file');
		}
		Access::assertWritable($upload);
		// It goes once streamed over: refused only then, the Version's file would be replaced and the upload left behind
		if (!$upload->isDeletable()) {
			throw new AccessDeniedException('Deleting the upload is not allowed');
		}
		if (!$confirm && $this->comments->findByVersion($versionId) !== []) {
			throw new ProjectConflictException($this->l->t('This Version has Comments, so replacing its file needs a confirmation.'), 'confirm');
		}
		$this->fileLock->inScope($file, static function () use ($file, $upload): void {
			$stream = $upload->fopen('r');
			try {
				$file->putContent($stream);
			} finally {
				// putContent closes it when it can
				if (is_resource($stream)) {
					fclose($stream);
				}
			}
			$upload->delete();
		});
		return $this->projects->versionPayload($this->versions->find($versionId) ?? $version, $uid);
	}
}
