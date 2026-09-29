<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;

/**
 * What Deliver's mappers share: a lookup by id that answers null, and deletes by one column.
 *
 * @template T of Entity
 * @template-extends QBMapper<T>
 */
abstract class Mapper extends QBMapper {
	/** @return ?T */
	public function find(int $id): ?Entity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/** Deletes every row whose column holds this id, e.g. `version_id` */
	public function deleteBy(string $column, int $id): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq($column, $qb->createNamedParameter($id)))
			->executeStatement();
	}

	/**
	 * For the rows that hang off Comments (attachments, reactions).
	 *
	 * @param list<int> $commentIds
	 * @return array<int, list<T>> per Comment, oldest first
	 */
	public function findByComments(array $commentIds): array {
		$byComment = [];
		foreach (array_chunk($commentIds, 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->in('comment_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->orderBy('id');
			$result = $qb->executeQuery();
			foreach ($result->fetchAll() as $row) {
				$byComment[(int)$row['comment_id']][] = $this->mapRowToEntity($row);
			}
			$result->closeCursor();
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
}
