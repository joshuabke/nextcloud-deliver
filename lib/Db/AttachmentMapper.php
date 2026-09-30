<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** @template-extends Mapper<Attachment> */
class AttachmentMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_attachments', Attachment::class);
	}

	/** @return int the bytes one person attached to Comments on one Version */
	public function bytesBy(int $versionId, ?string $uid, ?int $reviewerId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->sum('a.size'))
			->from($this->getTableName(), 'a')
			->innerJoin('a', 'deliver_comments', 'c', $qb->expr()->eq('c.id', 'a.comment_id'))
			->where($qb->expr()->eq('c.version_id', $qb->createNamedParameter($versionId)))
			->andWhere($reviewerId === null
				? $qb->expr()->eq('c.user_id', $qb->createNamedParameter((string)$uid))
				: $qb->expr()->eq('c.reviewer_id', $qb->createNamedParameter($reviewerId)));
		$result = $qb->executeQuery();
		$bytes = (int)$result->fetchOne();
		$result->closeCursor();
		return $bytes;
	}
}
