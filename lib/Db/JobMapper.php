<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Job> */
class JobMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_jobs', Job::class);
	}

	/**
	 * @param ?string $kind only jobs of this kind
	 * @return Job[] the oldest waiting work first, Scrub Proxies after everything else; a Deleted Project's waits until it is restored (ADR 0015)
	 */
	public function findQueued(int $limit, ?string $kind = null): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('j.*')->from($this->getTableName(), 'j')
			->leftJoin('j', 'deliver_versions', 'v', $qb->expr()->eq('v.id', 'j.version_id'))
			->leftJoin('v', 'deliver_projects', 'p', $qb->expr()->eq('p.id', 'v.project_id'))
			->where($qb->expr()->eq('j.state', $qb->createNamedParameter(Job::STATE_QUEUED)))
			->andWhere($qb->expr()->isNull('p.deleted_at'))
			->orderBy($qb->createFunction('CASE WHEN j.kind = ' . $qb->expr()->literal(Job::KIND_SCRUB) . ' THEN 1 ELSE 0 END'))
			->addOrderBy('j.id')
			->setMaxResults($limit);
		if ($kind !== null) {
			$qb->andWhere($qb->expr()->eq('j.kind', $qb->createNamedParameter($kind)));
		}
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

	/** Puts back jobs whose worker died: running, but started before a cutoff; a browser's Proxy lapses instead (DerivedMedia::lapse) */
	public function requeueStale(int $startedBefore): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('state', $qb->createNamedParameter(Job::STATE_QUEUED))
			->set('claimed_by', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_RUNNING)))
			->andWhere($qb->expr()->lt('started_at', $qb->createNamedParameter($startedBefore, IQueryBuilder::PARAM_INT)))
			->andWhere($this->onServer($qb))
			->executeStatement();
	}

	/** How many jobs the server runs right now, without the Proxies browsers make */
	public function countRunningOnServer(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'amount'))
			->from($this->getTableName())
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_RUNNING)))
			->andWhere($this->onServer($qb));
		$result = $qb->executeQuery();
		$amount = (int)$result->fetchOne();
		$result->closeCursor();
		return $amount;
	}

	private function onServer(IQueryBuilder $qb): string {
		// Every running row has a claimed_by (claim(), DerivedMedia::proxyProgress)
		return $qb->expr()->neq('claimed_by', $qb->createNamedParameter(Job::BROWSER));
	}

	/** @return Job[] failed jobs, the latest first; all of them without a limit */
	public function findFailed(?int $limit = null): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_FAILED)))
			->orderBy('finished_at', 'DESC')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	public function findLastFailed(): ?Job {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('state', $qb->createNamedParameter(Job::STATE_FAILED)))
			->orderBy('finished_at', 'DESC')
			->setMaxResults(1);
		return $this->findEntities($qb)[0] ?? null;
	}
}
