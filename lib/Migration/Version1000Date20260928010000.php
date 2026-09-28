<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** A Reviewer's own rights, over those of the Share Link they come by (null: the link decides) */
class Version1000Date20260928010000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		foreach (['can_comment', 'allow_older', 'watermark'] as $column) {
			if (!$table->hasColumn($column)) {
				$table->addColumn($column, Types::BOOLEAN, ['notnull' => false]);
			}
		}
		return $schema;
	}
}
