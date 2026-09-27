<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** What a Reviewer wants mailed: Replies, others' Comments, new Versions (null means the default) */
class Version1000Date20260927050000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		foreach (['mail_replies', 'mail_comments', 'mail_versions'] as $column) {
			if (!$table->hasColumn($column)) {
				$table->addColumn($column, Types::BOOLEAN, ['notnull' => false]);
			}
		}
		return $schema;
	}
}
