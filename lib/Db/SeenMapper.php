<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** @template-extends Mapper<Seen> */
class SeenMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_seen', Seen::class);
	}

	public function findForUser(int $versionId, string $userId): ?Seen {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		return $this->findEntities($qb)[0] ?? null;
	}

	public function findForReviewer(int $versionId, int $reviewerId): ?Seen {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->andWhere($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($reviewerId)));
		return $this->findEntities($qb)[0] ?? null;
	}
}
