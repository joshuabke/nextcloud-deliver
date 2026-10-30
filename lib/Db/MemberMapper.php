<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * What a Member with Manage set for a person or a group of a Project (ADR 0016);
 * a row is all there is, so there is no entity.
 */
class MemberMapper {
	private const TABLE = 'deliver_members';
	/** The newcomers setting each person or group was first seen under (null: as in Files) */
	private const SEEN = 'deliver_members_seen';
	public const USER = 'user';
	public const GROUP = 'group';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/** @return list<array{type: string, id: string, level: string, share: bool, approve: bool}> */
	public function forProject(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)))
			->orderBy('id');
		$result = $qb->executeQuery();
		$rows = array_map(static fn (array $row) => [
			'type' => (string)$row['principal_type'],
			'id' => (string)$row['principal_id'],
			'level' => (string)$row['level'],
			'share' => (bool)$row['share'],
			'approve' => (bool)$row['approve'],
		], $result->fetchAll());
		$result->closeCursor();
		return $rows;
	}

	/** @return array<string, ?string> the setting by "type/id" of everyone seen; a null value is a person seen while it was as in Files */
	public function seen(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('principal_type', 'principal_id', 'newcomers')->from(self::SEEN)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$seen = [];
		while ($row = $result->fetch()) {
			$seen[$row['principal_type'] . '/' . $row['principal_id']] = $row['newcomers'] === null ? null : (string)$row['newcomers'];
		}
		$result->closeCursor();
		return $seen;
	}

	/** Notes under which setting a person or group was first seen; a second note changes nothing */
	public function see(int $projectId, string $type, string $id, ?string $newcomers): void {
		$qb = $this->db->getQueryBuilder();
		$qb->insert(self::SEEN)->values([
			'project_id' => $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT),
			'principal_type' => $qb->createNamedParameter($type),
			'principal_id' => $qb->createNamedParameter($id),
			'newcomers' => $qb->createNamedParameter($newcomers),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			// Seen already, perhaps by another request in the same moment
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	public function set(int $projectId, string $type, string $id, string $level, bool $share, bool $approve): void {
		$this->remove($projectId, $type, $id);
		$qb = $this->db->getQueryBuilder();
		$qb->insert(self::TABLE)->values([
			'project_id' => $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT),
			'principal_type' => $qb->createNamedParameter($type),
			'principal_id' => $qb->createNamedParameter($id),
			'level' => $qb->createNamedParameter($level),
			'share' => $qb->createNamedParameter($share, IQueryBuilder::PARAM_BOOL),
			'approve' => $qb->createNamedParameter($approve, IQueryBuilder::PARAM_BOOL),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			// Another request set it in the same moment; its entry stands
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	public function remove(int $projectId, string $type, string $id): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('principal_type', $qb->createNamedParameter($type)))
			->andWhere($qb->expr()->eq('principal_id', $qb->createNamedParameter($id)))
			->executeStatement();
	}

	public function deleteByProject(int $projectId): void {
		foreach ([self::TABLE, self::SEEN] as $table) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($table)
				->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)))
				->executeStatement();
		}
	}

	/** A deleted account or group: its id may be given to the next one created */
	public function deleteByPrincipal(string $type, string $id): void {
		foreach ([self::TABLE, self::SEEN] as $table) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($table)
				->where($qb->expr()->eq('principal_type', $qb->createNamedParameter($type)))
				->andWhere($qb->expr()->eq('principal_id', $qb->createNamedParameter($id)))
				->executeStatement();
		}
	}
}
