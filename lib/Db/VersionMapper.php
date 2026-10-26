<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Version> */
class VersionMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_versions', Version::class);
	}

	/** @return Version[] the Version Stack of one Asset, lowest Version Number first */
	public function findByAsset(int $assetId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->orderBy('number');
		return $this->findEntities($qb);
	}

	/** The top of an Asset's Version Stack: its highest Version Number */
	public function findNewest(int $assetId): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->orderBy('number', 'DESC')
			->setMaxResults(1);
		return $this->findEntities($qb)[0] ?? null;
	}

	/** @return Version[] all Versions of every Asset in the Project, newest Version Number first */
	public function findByProject(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->orderBy('number', 'DESC');
		return $this->findEntities($qb);
	}

	/** A file is one Version at most, wherever it lies (ADR 0009) */
	public function findByFile(int $fileId): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * @param list<int> $fileIds
	 * @return Version[] the Versions of these files, newest Version Number first
	 */
	public function findByFiles(array $fileIds): array {
		$found = [];
		// Databases cap the length of an IN list
		foreach (array_chunk(array_values(array_unique($fileIds)), 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->in('file_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->orderBy('number', 'DESC');
			array_push($found, ...$this->findEntities($qb));
		}
		return $found;
	}

	/**
	 * Which of these files the user can open in Files, in one query rather
	 * than a node lookup each (#64): a file under one of the user's mounts, as
	 * Nextcloud's mount cache holds them, below their files folder. The
	 * mount cache is what Nextcloud itself asks first for a file by id.
	 *
	 * @param list<int> $fileIds
	 * @return array<int, true> by file id
	 */
	public function openableFiles(string $uid, array $fileIds): array {
		$open = [];
		$home = '/' . $uid . '/files/';
		foreach (array_chunk(array_values(array_unique($fileIds)), 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('f.fileid', 'f.path', 'm.mount_point')->selectAlias('r.path', 'root_path')
				->from('mounts', 'm')
				->innerJoin('m', 'filecache', 'r', $qb->expr()->eq('r.fileid', 'm.root_id'))
				->innerJoin('m', 'filecache', 'f', $qb->expr()->eq('f.storage', 'm.storage_id'))
				->where($qb->expr()->eq('m.user_id', $qb->createNamedParameter($uid)))
				->andWhere($qb->expr()->in('f.fileid', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
			$result = $qb->executeQuery();
			foreach ($result->fetchAll() as $row) {
				$root = (string)$row['root_path'];
				$path = (string)$row['path'];
				// A shared file is the root of its mount itself
				if ($root !== '' && $path !== $root && !str_starts_with($path, $root . '/')) {
					continue;
				}
				// The home mount holds the trash and old file versions too, outside files/
				if (str_starts_with($row['mount_point'] . ltrim(substr($path, strlen($root)), '/'), $home)) {
					$open[(int)$row['fileid']] = true;
				}
			}
			$result->closeCursor();
		}
		return $open;
	}

	/**
	 * @param list<int> $assetIds
	 * @return Version[] all Versions of these Assets, newest Version Number first
	 */
	public function findByAssets(array $assetIds): array {
		if ($assetIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('asset_id', $qb->createNamedParameter($assetIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->orderBy('number', 'DESC');
		return $this->findEntities($qb);
	}

	/** Every Version, for the periodic check of their files */
	public function findAll(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName());
		return $this->findEntities($qb);
	}

	/** Copies an Asset's Project onto its Versions */
	public function setProjectOfAsset(int $assetId, ?int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('project_id', $qb->createNamedParameter($projectId))
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->executeStatement();
	}
}
