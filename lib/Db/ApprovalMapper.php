<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IDBConnection;

/** @template-extends ReviewDataMapper<Approval> */
class ApprovalMapper extends ReviewDataMapper {
	public function __construct(IDBConnection $db, IEventDispatcher $events) {
		parent::__construct($db, 'deliver_approvals', Approval::class, $events);
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
	 * @return array<int, array{approved: int, changes: int}> per Version asked for, zero where nobody decided
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
		$counts = array_fill_keys($versionIds, ['approved' => 0, 'changes' => 0]);
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$counts[(int)$row['version_id']][$row['status']] = (int)$row['n'];
		}
		$result->closeCursor();
		return $counts;
	}
}
