<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\IDBConnection;

/** @template-extends QBMapper<Version> */
class VersionMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_versions', Version::class);
	}

	public function find(int $id): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/** @return Version[] the Version Stack of one Asset, lowest Version Number first */
	public function findByAsset(int $assetId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->orderBy('number');
		return $this->findEntities($qb);
	}

	/** @return Version[] all Versions of every Asset in the Project, newest Version Number first */
	public function findByProject(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->orderBy('number', 'DESC');
		return $this->findEntities($qb);
	}

	/** A file is at most one Version within a Project */
	public function findByProjectAndFile(int $projectId, int $fileId): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return Version[] every Version that points at this file, across Projects */
	public function findByFile(int $fileId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)));
		return $this->findEntities($qb);
	}

	public function deleteByAsset(int $assetId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->executeStatement();
	}

	public function deleteByProject(int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->executeStatement();
	}
}
