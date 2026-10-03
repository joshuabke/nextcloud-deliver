<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\IDBConnection;

/** @template-extends Mapper<ProjectLink> */
class ProjectLinkMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_project_links', ProjectLink::class);
	}

	public function findByToken(string $token): ?ProjectLink {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('token', $qb->createNamedParameter($token)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/** @return ProjectLink[] every Member's links on a Project */
	public function findAllOf(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)));
		return $this->findEntities($qb);
	}

	/** @return ProjectLink[] a Member's links on a Project, oldest first */
	public function findByProject(int $projectId, string $ownerUid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->andWhere($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)))
			->orderBy('id');
		return $this->findEntities($qb);
	}
}
