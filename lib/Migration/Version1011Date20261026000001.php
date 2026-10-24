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
 * A Reviewer's key now lives on each of their links (Version1010), so a
 * removed Reviewer is marked as such instead of by a missing key. Version1012
 * drops the key from the Reviewer.
 */
class Version1011Date20261026000001 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if ($table->hasColumn('removed_at')) {
			return null;
		}
		// Null while they review
		$table->addColumn('removed_at', Types::BIGINT, ['notnull' => false]);
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->getTable('deliver_reviewers')->hasColumn('secret_key')) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update('deliver_reviewers')
			->set('removed_at', $qb->createNamedParameter(time(), IQueryBuilder::PARAM_INT))
			->where($qb->expr()->isNull('secret_key'))
			->andWhere($qb->expr()->isNull('removed_at'))
			->executeStatement();
	}
}
