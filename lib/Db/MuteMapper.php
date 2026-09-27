<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\Exception as DbException;
use OCP\IDBConnection;

/** Who muted which Project (story 64); a row is all there is, so there is no entity */
class MuteMapper {
	private const TABLE = 'deliver_mutes';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/** @return list<string> the users who muted this Project */
	public function mutedBy(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('user_id')->from(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		$result = $qb->executeQuery();
		$users = array_map('strval', $result->fetchAll(\PDO::FETCH_COLUMN));
		$result->closeCursor();
		return $users;
	}

	public function isMuted(int $projectId, string $uid): bool {
		return in_array($uid, $this->mutedBy($projectId), true);
	}

	public function set(int $projectId, string $uid, bool $muted): void {
		if (!$muted) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete(self::TABLE)
				->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
				->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($uid)))
				->executeStatement();
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->insert(self::TABLE)->values([
			'project_id' => $qb->createNamedParameter($projectId),
			'user_id' => $qb->createNamedParameter($uid),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	public function deleteByProject(int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->executeStatement();
	}
}
