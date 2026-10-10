<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\Exception as DbException;
use OCP\IDBConnection;

/**
 * The files a Member removed from a Folder Project, by file id, so a rename,
 * a move inside the folder or an overwrite keeps them out of Auto Intake
 * (story 132); a row is all there is, so there is no entity.
 * ponytail: a file deleted for good leaves its row behind, harmless as file ids are not reused
 */
class RemovedMapper {
	private const TABLE = 'deliver_removed';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/** @return list<int> */
	public function fileIds(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id')->from(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		$result = $qb->executeQuery();
		$ids = array_map('intval', $result->fetchAll(\PDO::FETCH_COLUMN));
		$result->closeCursor();
		return $ids;
	}

	public function isRemoved(int $projectId, int $fileId): bool {
		return in_array($fileId, $this->fileIds($projectId), true);
	}

	public function mark(int $projectId, int $fileId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->insert(self::TABLE)->values([
			'project_id' => $qb->createNamedParameter($projectId),
			'file_id' => $qb->createNamedParameter($fileId),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	public function lift(int $projectId, int $fileId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)))
			->executeStatement();
	}

	public function deleteByProject(int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->executeStatement();
	}
}
