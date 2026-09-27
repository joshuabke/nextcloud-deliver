<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Job> */
class JobMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_jobs', Job::class);
	}

	/** @return Job[] the oldest waiting work first */
	public function findQueued(int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_QUEUED)))
			->orderBy('id')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	public function findPending(int $versionId, string $kind): ?Job {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->andWhere($qb->expr()->eq('kind', $qb->createNamedParameter($kind)))
			->andWhere($qb->expr()->in('state', $qb->createNamedParameter(
				[Job::STATE_QUEUED, Job::STATE_RUNNING],
				IQueryBuilder::PARAM_STR_ARRAY,
			)));
		return $this->findEntities($qb)[0] ?? null;
	}

	/** Claims a queued job; false when another worker claimed it first */
	public function claim(Job $job, string $worker, int $now): bool {
		$qb = $this->db->getQueryBuilder();
		$updated = $qb->update($this->getTableName())
			->set('state', $qb->createNamedParameter(Job::STATE_RUNNING))
			->set('claimed_by', $qb->createNamedParameter($worker))
			->set('started_at', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->set('attempts', $qb->createFunction('attempts + 1'))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($job->getId())))
			->andWhere($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_QUEUED)))
			->executeStatement();
		return $updated === 1;
	}

	/** @return array<string, int> how many jobs sit in each state */
	public function countByState(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('state')->selectAlias($qb->func()->count('*'), 'amount')
			->from($this->getTableName())
			->groupBy('state');
		$result = $qb->executeQuery();
		$counts = [];
		foreach ($result->fetchAll() as $row) {
			$counts[(string)$row['state']] = (int)$row['amount'];
		}
		$result->closeCursor();
		return $counts;
	}

	public function setProgress(int $jobId, int $percent): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('progress', $qb->createNamedParameter($percent, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($jobId, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	public function countRunning(): int {
		return $this->countByState()[Job::STATE_RUNNING] ?? 0;
	}

	/** Puts back jobs whose worker died: running, but started before a cutoff */
	public function requeueStale(int $startedBefore): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('state', $qb->createNamedParameter(Job::STATE_QUEUED))
			->set('claimed_by', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_RUNNING)))
			->andWhere($qb->expr()->lt('started_at', $qb->createNamedParameter($startedBefore, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	public function findLastFailed(): ?Job {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_FAILED)))
			->orderBy('finished_at', 'DESC')
			->setMaxResults(1);
		return $this->findEntities($qb)[0] ?? null;
	}

	public function deleteByVersion(int $versionId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('version_id', $qb->createNamedParameter($versionId)))
			->executeStatement();
	}
}
