<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Asset> */
class AssetMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_assets', Asset::class);
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

	/**
	 * @param list<int> $ids
	 * @return Asset[]
	 */
	public function findByIds(array $ids): array {
		if ($ids === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('id', $qb->createNamedParameter($ids, IQueryBuilder::PARAM_INT_ARRAY)));
		return $this->findEntities($qb);
	}

	/** @return Asset[] the Assets of No Project a Member enabled (ADR 0009) */
	public function findUnassigned(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->isNull('project_id'))
			->andWhere($qb->expr()->eq('enabled_by', $qb->createNamedParameter($uid)));
		return $this->findEntities($qb);
	}

	/**
	 * Puts every Asset of a Project into No Project, for whoever enabled it,
	 * or else the given Member.
	 */
	public function release(int $projectId, string $uid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('enabled_by', $qb->createNamedParameter($uid))
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->andWhere($qb->expr()->isNull('enabled_by'))
			->executeStatement();
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('project_id', $qb->createNamedParameter(null))
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
