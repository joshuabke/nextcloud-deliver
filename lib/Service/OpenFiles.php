<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\Files\Config\IUserMountCache;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Mount\IMountManager;
use OCP\Files\Node;
use OCP\IDBConnection;
use OCP\IUserManager;

/**
 * Which of many files a user can open in Files, without a node lookup for
 * each (#64): a node lookup costs a few queries, and the Project list asks
 * for every Version on each poll.
 */
class OpenFiles {
	public function __construct(
		private IMountManager $mountManager,
		private IUserMountCache $mountCache,
		private IUserManager $users,
		private IDBConnection $db,
	) {
	}

	/**
	 * A file under one of the user's mounts and below their files folder is
	 * a candidate; it is open when a listing of its folder shows it, so
	 * that what the mount hides (a Group folder's ACLs) stays hidden. One
	 * lookup per folder, not per file.
	 *
	 * @param list<int> $fileIds
	 * @return array<int, true> by file id
	 */
	public function among(Folder $home, array $fileIds): array {
		$user = $this->users->get(explode('/', $home->getPath())[1] ?? '');
		if ($fileIds === [] || $user === null) {
			return [];
		}
		// Sets up all of the user's mounts, as Files does, which brings Nextcloud's mount cache up to date
		$this->mountManager->findIn($home->getPath());
		$mounts = $this->mountCache->getMountsForUser($user);
		$below = $home->getPath() . '/';
		$byFolder = [];
		foreach ($this->cached($fileIds) as $id => [$storage, $path, $parent]) {
			foreach ($mounts as $mount) {
				$root = $mount->getRootInternalPath();
				// A file shared on its own is the root of its mount itself
				if ($mount->getStorageId() !== $storage || ($root !== '' && $path !== $root && !str_starts_with($path, $root . '/'))) {
					continue;
				}
				// The home mount holds the trash and old file versions too, outside files/
				if (str_starts_with($mount->getMountPoint() . ltrim(substr($path, strlen($root)), '/'), $below)) {
					$byFolder[$parent][] = $id;
					break;
				}
			}
		}
		$open = [];
		foreach ($byFolder as $folderId => $ids) {
			$folder = $home->getFirstNodeById($folderId);
			$listed = $folder instanceof Folder
				? array_flip(array_map(static fn (Node $node) => $node->getId(), $folder->getDirectoryListing()))
				: null;
			foreach ($ids as $id) {
				// Without its folder, a file shared on its own is looked up by itself
				if ($listed === null ? $home->getFirstNodeById($id) instanceof File : isset($listed[$id])) {
					$open[$id] = true;
				}
			}
		}
		return $open;
	}

	/**
	 * @param list<int> $fileIds
	 * @return array<int, array{0: int, 1: string, 2: int}> storage, path and parent folder by file id
	 */
	private function cached(array $fileIds): array {
		$found = [];
		foreach (array_chunk(array_values(array_unique($fileIds)), 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('fileid', 'storage', 'path', 'parent')->from('filecache')
				->where($qb->expr()->in('fileid', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
			$result = $qb->executeQuery();
			foreach ($result->fetchAll() as $row) {
				$found[(int)$row['fileid']] = [(int)$row['storage'], (string)$row['path'], (int)$row['parent']];
			}
			$result->closeCursor();
		}
		return $found;
	}
}
