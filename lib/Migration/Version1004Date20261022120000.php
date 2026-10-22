<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * A Reviewer belongs to one Project (ADR 0013). Who is there already joins
 * the Project of the first link they came by that still stands.
 * ponytail: one who came by links of several Projects keeps only the first; a Member invites them again for the others
 */
class Version1004Date20261022120000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if ($table->hasColumn('project_id')) {
			return null;
		}
		// Null for No Project
		$table->addColumn('project_id', Types::BIGINT, ['notnull' => false]);
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('rl.reviewer_id', 'pl.project_id')->from('deliver_reviewer_links', 'rl')
			->innerJoin('rl', 'deliver_project_links', 'pl', $qb->expr()->eq('pl.token', 'rl.token'))
			->where($qb->expr()->isNotNull('pl.project_id'))
			->orderBy('rl.created_at')->addOrderBy('rl.id');
		$result = $qb->executeQuery();
		$projects = [];
		foreach ($result->fetchAll() as $row) {
			$projects[(int)$row['reviewer_id']] ??= (int)$row['project_id'];
		}
		$result->closeCursor();

		$update = $this->db->getQueryBuilder();
		$update->update('deliver_reviewers')
			->set('project_id', $update->createParameter('project'))
			->where($update->expr()->eq('id', $update->createParameter('id')));
		foreach ($projects as $reviewerId => $projectId) {
			$update->setParameter('project', $projectId, IQueryBuilder::PARAM_INT)
				->setParameter('id', $reviewerId, IQueryBuilder::PARAM_INT)
				->executeStatement();
		}
	}
}
