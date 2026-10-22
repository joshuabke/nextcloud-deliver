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
 * the Project of the first link they came by that still stands, or else of
 * the first Version they commented on; they leave the lists of the links of
 * other Projects. Whoever has neither is removed, as nothing leads to them.
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
		// Every link each Reviewer came by that still stands, first first
		$qb = $this->db->getQueryBuilder();
		$qb->select('rl.id', 'rl.reviewer_id', 'pl.project_id')->from('deliver_reviewer_links', 'rl')
			->innerJoin('rl', 'deliver_project_links', 'pl', $qb->expr()->eq('pl.token', 'rl.token'))
			->orderBy('rl.created_at')->addOrderBy('rl.id');
		$cameBy = $this->rows($qb);

		$qb = $this->db->getQueryBuilder();
		$qb->select('c.reviewer_id', 'v.project_id')->from('deliver_comments', 'c')
			->innerJoin('c', 'deliver_versions', 'v', $qb->expr()->eq('v.id', 'c.version_id'))
			->where($qb->expr()->isNotNull('c.reviewer_id'))
			->orderBy('c.id');
		$commented = $this->rows($qb);

		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from('deliver_reviewers')->where($qb->expr()->isNotNull('secret_key'));
		$reviewerIds = array_map(static fn (array $row) => (int)$row['id'], $this->rows($qb));

		/** @var array<int, ?int> $projects reviewer id → their Project, null for No Project */
		$projects = [];
		foreach ([...$cameBy, ...$commented] as $row) {
			$reviewerId = (int)$row['reviewer_id'];
			if (!array_key_exists($reviewerId, $projects)) {
				$projects[$reviewerId] = $row['project_id'] === null ? null : (int)$row['project_id'];
			}
		}

		$update = $this->db->getQueryBuilder();
		$update->update('deliver_reviewers')
			->set('project_id', $update->createParameter('project'))
			->where($update->expr()->eq('id', $update->createParameter('id')));
		$remove = $this->db->getQueryBuilder();
		$remove->update('deliver_reviewers')
			->set('secret_key', $remove->createNamedParameter(null))
			->where($remove->expr()->eq('id', $remove->createParameter('id')));
		foreach ($reviewerIds as $reviewerId) {
			if (!array_key_exists($reviewerId, $projects)) {
				$remove->setParameter('id', $reviewerId, IQueryBuilder::PARAM_INT)->executeStatement();
			} elseif ($projects[$reviewerId] !== null) {
				$update->setParameter('project', $projects[$reviewerId], IQueryBuilder::PARAM_INT)
					->setParameter('id', $reviewerId, IQueryBuilder::PARAM_INT)
					->executeStatement();
			}
		}

		// The links of other Projects forget them, so their name is free there again
		$forget = $this->db->getQueryBuilder();
		$forget->delete('deliver_reviewer_links')->where($forget->expr()->eq('id', $forget->createParameter('id')));
		foreach ($cameBy as $row) {
			$projectId = $row['project_id'] === null ? null : (int)$row['project_id'];
			if (($projects[(int)$row['reviewer_id']] ?? null) !== $projectId) {
				$forget->setParameter('id', (int)$row['id'], IQueryBuilder::PARAM_INT)->executeStatement();
			}
		}
	}

	/** @return list<array<string, mixed>> */
	private function rows(IQueryBuilder $qb): array {
		$result = $qb->executeQuery();
		$rows = $result->fetchAll();
		$result->closeCursor();
		return $rows;
	}
}
