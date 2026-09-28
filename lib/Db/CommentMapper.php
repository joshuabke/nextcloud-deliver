<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Comment> */
class CommentMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_comments', Comment::class);
	}

	public function find(int $id): ?Comment {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/**
	 * In Frame order, like the marker strip. Replies share their parent's
	 * anchor, so they sort next to it, in the order they were written.
	 *
	 * @return Comment[]
	 */
	public function findByVersion(int $versionId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->orderBy('in_frame')->addOrderBy('id');
		return $this->findEntities($qb);
	}

	/** @return Comment[] Comments written or changed at or after a timestamp, in Frame order */
	public function findChangedSince(int $versionId, int $since): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->andWhere($qb->expr()->gte('updated_at', $qb->createNamedParameter($since)))
			->orderBy('in_frame')->addOrderBy('id');
		return $this->findEntities($qb);
	}

	/** @return Comment[] the Replies of one Comment */
	public function findByParent(int $parentId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('parent_id', $qb->createNamedParameter($parentId)));
		return $this->findEntities($qb);
	}

	/**
	 * @param list<int> $versionIds
	 * @return array<int, int> Version id → how many Comments and Replies it has
	 */
	public function countByVersions(array $versionIds): array {
		if ($versionIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('version_id')->selectAlias($qb->func()->count('*'), 'amount')
			->from($this->getTableName())
			->where($qb->expr()->in('version_id', $qb->createNamedParameter($versionIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->groupBy('version_id');
		return $this->amounts($qb);
	}

	/**
	 * Comments and Replies by others that came after the person's Unseen mark,
	 * or all of them where the person never had the Version on screen.
	 *
	 * @param list<int> $versionIds
	 * @return array<int, int> Version id → how many are Unseen
	 */
	public function countUnseenByVersions(array $versionIds, string $uid): array {
		if ($versionIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('c.version_id')->selectAlias($qb->func()->count('*'), 'amount')
			->from($this->getTableName(), 'c')
			->leftJoin('c', 'deliver_seen', 's', $qb->expr()->andX(
				$qb->expr()->eq('s.version_id', 'c.version_id'),
				$qb->expr()->eq('s.user_id', $qb->createNamedParameter($uid)),
			))
			->where($qb->expr()->in('c.version_id', $qb->createNamedParameter($versionIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->isNull('c.user_id'),
				$qb->expr()->neq('c.user_id', $qb->createNamedParameter($uid)),
			))
			->andWhere($qb->expr()->orX(
				$qb->expr()->isNull('s.seen_until'),
				$qb->expr()->gt('c.created_at', 's.seen_until'),
			))
			->groupBy('c.version_id');
		return $this->amounts($qb);
	}

	/**
	 * @param list<int> $versionIds
	 * @return int|null when the newest Comment or Reply on these Versions was written
	 */
	public function latestOn(array $versionIds): ?int {
		if ($versionIds === []) {
			return null;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->max('created_at'))
			->from($this->getTableName())
			->where($qb->expr()->in('version_id', $qb->createNamedParameter($versionIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$latest = $result->fetchOne();
		$result->closeCursor();
		return $latest === null || $latest === false ? null : (int)$latest;
	}

	/** @return array<int, int> version_id → amount of a grouped count */
	private function amounts(IQueryBuilder $qb): array {
		$result = $qb->executeQuery();
		$counts = [];
		foreach ($result->fetchAll() as $row) {
			$counts[(int)$row['version_id']] = (int)$row['amount'];
		}
		$result->closeCursor();
		return $counts;
	}

	public function deleteByVersion(int $versionId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->executeStatement();
	}
}
