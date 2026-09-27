<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Attachment> */
class AttachmentMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_attachments', Attachment::class);
	}

	public function find(int $id): ?Attachment {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * @param list<int> $commentIds
	 * @return array<int, list<Attachment>> per Comment, in upload order
	 */
	public function findByComments(array $commentIds): array {
		$byComment = [];
		foreach (array_chunk($commentIds, 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->in('comment_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->orderBy('id');
			foreach ($this->findEntities($qb) as $attachment) {
				$byComment[$attachment->getCommentId()][] = $attachment;
			}
		}
		return $byComment;
	}

	/** @param list<int> $commentIds */
	public function deleteByComments(array $commentIds): void {
		foreach (array_chunk($commentIds, 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($this->getTableName())
				->where($qb->expr()->in('comment_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->executeStatement();
		}
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
