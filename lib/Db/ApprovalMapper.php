<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Approval> */
class ApprovalMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_approvals', Approval::class);
	}

	/** @return list<Approval> */
	public function findByVersion(int $versionId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->orderBy('updated_at')->addOrderBy('id');
		return $this->findEntities($qb);
	}

	/**
	 * @param list<int> $versionIds
	 * @return array<int, array{approved: int, changes: int}> per Version, those with decisions only
	 */
	public function countByVersions(array $versionIds): array {
		if ($versionIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('version_id', 'status')->selectAlias($qb->func()->count('id'), 'n')
			->from($this->getTableName())
			->where($qb->expr()->in('version_id', $qb->createNamedParameter($versionIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->groupBy('version_id', 'status');
		$counts = [];
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$counts[(int)$row['version_id']] ??= ['approved' => 0, 'changes' => 0];
			$counts[(int)$row['version_id']][$row['status']] = (int)$row['n'];
		}
		$result->closeCursor();
		return $counts;
	}
}
