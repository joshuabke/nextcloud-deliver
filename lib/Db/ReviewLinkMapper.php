<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** @template-extends Mapper<ReviewLinkRecord> */
class ReviewLinkMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_review_links', ReviewLinkRecord::class);
	}

	public function findByToken(string $token): ?ReviewLinkRecord {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('token', $qb->createNamedParameter($token)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/** @return ReviewLinkRecord[] every Member's links on a Project */
	public function findAllOf(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		return $this->findEntities($qb);
	}

	/** @return ReviewLinkRecord[] every link a Member made */
	public function findByOwner(string $ownerUid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)));
		return $this->findEntities($qb);
	}

	/** @return ReviewLinkRecord[] a Member's links on a Project, or to Assets of No Project for null, oldest first */
	public function findByProject(?int $projectId, string $ownerUid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($projectId === null ? $qb->expr()->isNull('project_id') : $qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->andWhere($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)))
			->orderBy('id');
		return $this->findEntities($qb);
	}
}
