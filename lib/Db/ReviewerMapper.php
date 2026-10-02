<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Reviewer> */
class ReviewerMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_reviewers', Reviewer::class);
	}

	/** The key of a Personal Link identifies its Reviewer */
	public function findByKey(string $secretKey): ?Reviewer {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('secret_key', $qb->createNamedParameter($secretKey)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/**
	 * @param list<string> $uids
	 * @return Reviewer[] the Reviewers of these Members, oldest first; removed ones left out
	 */
	public function findByOwners(array $uids): array {
		if ($uids === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('owner_uid', $qb->createNamedParameter($uids, IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->isNotNull('secret_key'))
			->orderBy('created_at');
		return $this->findEntities($qb);
	}

	/** Remembers that the Reviewer was invited through or came in by this Share Link; once is enough */
	public function recordLink(int $reviewerId, int $shareId, int $at): void {
		$qb = $this->db->getQueryBuilder();
		$qb->insert('deliver_reviewer_links')->values([
			'reviewer_id' => $qb->createNamedParameter($reviewerId),
			'share_id' => $qb->createNamedParameter($shareId),
			'created_at' => $qb->createNamedParameter($at),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	/**
	 * @param list<int> $reviewerIds
	 * @return array<int, list<int>> Share Link id → the Reviewers who came by it
	 */
	public function reviewersByLink(array $reviewerIds): array {
		if ($reviewerIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'share_id')->from('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$byLink = [];
		foreach ($result->fetchAll() as $row) {
			$byLink[(int)$row['share_id']][] = (int)$row['reviewer_id'];
		}
		$result->closeCursor();
		return $byLink;
	}

	/** @param list<int> $reviewerIds */
	public function deleteLinks(array $reviewerIds): void {
		if ($reviewerIds === []) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->executeStatement();
	}
}
