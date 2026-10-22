<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCA\Deliver\BackgroundJob\ProcessDerivedMedia;
use OCA\Deliver\BackgroundJob\RemindDueDates;
use OCP\BackgroundJob\IJob;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Derived media and reminders run outside the maintenance window. Nextcloud
 * keeps a job's earlier time-insensitive flag in the job list and never sets
 * it back, and cron skips such a row outside the window, so the row changes here.
 */
class Version1003Date20261022000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('jobs')
			->set('time_sensitive', $qb->createNamedParameter(IJob::TIME_SENSITIVE, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->in('class', $qb->createNamedParameter([ProcessDerivedMedia::class, RemindDueDates::class], IQueryBuilder::PARAM_STR_ARRAY)))
			->executeStatement();
	}
}
