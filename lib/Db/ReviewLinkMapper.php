<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** @template-extends Mapper<ReviewLinkRecord> */
class ReviewLinkMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_review_links', ReviewLinkRecord::class);
	}

	/**
	 * Deletes a link with all that goes by its token: its activity, and the
	 * Reviewers' places on it with their keys and rights there. The Reviewers
	 * stay, as do their Comments (ADR 0014).
	 */
	public function forget(ReviewLinkRecord $link): void {
		foreach (['deliver_link_activity', 'deliver_reviewer_links'] as $table) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($table)->where($qb->expr()->eq('token', $qb->createNamedParameter($link->getToken())))->executeStatement();
		}
		$this->delete($link);
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

	/**
	 * @param string $ownerUid whose No Project, when $projectId is null; a Project's links are every Member's (ADR 0017)
	 * @return ReviewLinkRecord[] the links on a Project, or the Member's to Assets of No Project for null, oldest first
	 */
	public function findByProject(?int $projectId, string $ownerUid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())->orderBy('id');
		if ($projectId === null) {
			$qb->where($qb->expr()->isNull('project_id'))
				->andWhere($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)));
		} else {
			$qb->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		}
		return $this->findEntities($qb);
	}
}
