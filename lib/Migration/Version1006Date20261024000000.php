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
 * A Reviewer's own rights belong to each link they come by (ADR 0014). Each
 * link of theirs takes the rights they had, so that nobody gains or loses one;
 * Version1007 then drops them from the Reviewer.
 */
class Version1006Date20261024000000 extends SimpleMigrationStep {
	private const RIGHTS = ['can_comment', 'allow_older', 'watermark'];

	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewer_links');
		if ($table->hasColumn('can_comment')) {
			return null;
		}
		// Null leaves it to the link
		foreach (self::RIGHTS as $right) {
			$table->addColumn($right, Types::BOOLEAN, ['notnull' => false]);
		}
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', ...self::RIGHTS)->from('deliver_reviewers')
			->where($qb->expr()->orX(...array_map(static fn (string $right) => $qb->expr()->isNotNull($right), self::RIGHTS)));
		$result = $qb->executeQuery();
		$update = $this->db->getQueryBuilder();
		$update->update('deliver_reviewer_links')->where($update->expr()->eq('reviewer_id', $update->createParameter('id')));
		foreach (self::RIGHTS as $right) {
			$update->set($right, $update->createParameter($right));
		}
		while (($row = $result->fetch()) !== false) {
			$update->setParameter('id', (int)$row['id'], IQueryBuilder::PARAM_INT);
			foreach (self::RIGHTS as $right) {
				$update->setParameter($right, $row[$right] === null ? null : (bool)$row[$right], $row[$right] === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_BOOL);
			}
			$update->executeStatement();
		}
		$result->closeCursor();
	}
}
