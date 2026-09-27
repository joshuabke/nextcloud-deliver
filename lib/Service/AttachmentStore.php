<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Project;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\InvalidPathException;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;

/**
 * The files of Comment attachments (story 92). They live in the Project
 * folder, in a hidden folder per Comment, and are written as the Project's
 * owner, so a Reviewer on a read-only link can attach too.
 */
class AttachmentStore {
	public function __construct(
		private IRootFolder $root,
	) {
	}

	/**
	 * @param resource $content
	 * @throws NotFoundException the Project folder is gone
	 */
	public function store(Project $project, int $commentId, string $name, $content): File {
		$folder = $this->commentFolder($project, $commentId, true)
			?? throw new InvalidRequestException('Something named ' . Reviewable::ATTACHMENTS . ' in the Project folder is in the way');
		try {
			return $folder->newFile($this->freeName($folder, $name), $content);
		} catch (InvalidPathException|NotPermittedException $e) {
			throw new InvalidRequestException('This file name cannot be stored: ' . $e->getMessage());
		}
	}

	public function file(Project $project, int $fileId): ?File {
		$file = $this->projectFolder($project)?->getFirstNodeById($fileId);
		return $file instanceof File ? $file : null;
	}

	/** Deletes the attachments of a Comment, folder and all */
	public function forget(Project $project, int $commentId): void {
		try {
			$this->commentFolder($project, $commentId, false)?->delete();
		} catch (NotFoundException) {
		}
	}

	private function projectFolder(Project $project): ?Folder {
		$folder = $this->root->getUserFolder($project->getOwnerUid())->getFirstNodeById($project->getFolderId());
		return $folder instanceof Folder ? $folder : null;
	}

	/** @throws NotFoundException the Project folder is gone */
	private function commentFolder(Project $project, int $commentId, bool $create): ?Folder {
		$folder = $this->projectFolder($project) ?? throw new NotFoundException('Project folder not found');
		foreach ([Reviewable::ATTACHMENTS, (string)$commentId] as $name) {
			if ($folder->nodeExists($name)) {
				$next = $folder->get($name);
				if (!$next instanceof Folder) {
					return null;
				}
				$folder = $next;
			} elseif ($create) {
				$folder = $folder->newFolder($name);
			} else {
				return null;
			}
		}
		return $folder;
	}

	/** "shot.png", then "shot (2).png" if that is taken */
	private function freeName(Folder $folder, string $name): string {
		$name = trim(str_replace(['/', '\\', "\0"], '_', $name), " \t\n\r.");
		// Leading dots would hide the file; very long names break file systems
		$name = mb_substr($name, -200) ?: 'attachment';
		$candidate = $name;
		$dot = strrpos($name, '.');
		[$base, $ending] = $dot > 0 ? [substr($name, 0, $dot), substr($name, $dot)] : [$name, ''];
		for ($n = 2; $folder->nodeExists($candidate); $n++) {
			$candidate = "$base ($n)$ending";
		}
		return $candidate;
	}
}
