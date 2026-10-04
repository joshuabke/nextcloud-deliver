<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** What happened on a link, by its token: opened, a Version viewed or downloaded (story 124) */
class LinkActivityMapper {
	public const OPENED = 'opened';
	public const VIEWED = 'viewed';
	public const DOWNLOADED = 'downloaded';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function record(string $token, string $kind, ?int $reviewerId, ?int $versionId, int $at): void {
		$qb = $this->db->getQueryBuilder();
		$qb->insert('deliver_link_activity')->values([
			'token' => $qb->createNamedParameter($token),
			'kind' => $qb->createNamedParameter($kind),
			'reviewer_id' => $qb->createNamedParameter($reviewerId),
			'version_id' => $qb->createNamedParameter($versionId),
			'created_at' => $qb->createNamedParameter($at),
		])->executeStatement();
	}

	/** @return list<array{kind: string, reviewerId: ?int, versionId: ?int, at: int}> newest first */
	public function latest(string $token, int $limit = 200): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('kind', 'reviewer_id', 'version_id', 'created_at')->from('deliver_link_activity')
			->where($qb->expr()->eq('token', $qb->createNamedParameter($token)))
			->orderBy('id', 'DESC')
			->setMaxResults($limit);
		$result = $qb->executeQuery();
		$rows = array_map(static fn (array $row) => [
			'kind' => (string)$row['kind'],
			'reviewerId' => $row['reviewer_id'] === null ? null : (int)$row['reviewer_id'],
			'versionId' => $row['version_id'] === null ? null : (int)$row['version_id'],
			'at' => (int)$row['created_at'],
		], $result->fetchAll());
		$result->closeCursor();
		return $rows;
	}

	public function deleteByToken(string $token): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deliver_link_activity')
			->where($qb->expr()->eq('token', $qb->createNamedParameter($token)))
			->executeStatement();
	}
}
