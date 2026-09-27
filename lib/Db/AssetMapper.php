<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Asset> */
class AssetMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_assets', Asset::class);
	}

	public function find(int $id): ?Asset {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		$found = $this->findEntities($qb);
		return $found[0] ?? null;
	}

	public function countByProject(int $projectId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*'))->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		$result = $qb->executeQuery();
		$count = (int)$result->fetchOne();
		$result->closeCursor();
		return $count;
	}

	/** @return Asset[] */
	public function findByProject(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		return $this->findEntities($qb);
	}

	public function deleteByProject(int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->executeStatement();
	}

	/**
	 * @param list<string> $days YYYY-MM-DD
	 * @return list<Asset> the Assets due on one of the days
	 */
	public function findDueOn(array $days): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('due_date', $qb->createNamedParameter($days, IQueryBuilder::PARAM_STR_ARRAY)));
		return $this->findEntities($qb);
	}
}
