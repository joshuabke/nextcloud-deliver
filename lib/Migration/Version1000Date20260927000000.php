<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Approvals: one decision per person and Version (story 88) */
class Version1000Date20260927000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('deliver_approvals')) {
			$t = $schema->createTable('deliver_approvals');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('version_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['version_id', 'user_id'], 'deliver_appr_user_uniq');
			$t->addUniqueIndex(['version_id', 'reviewer_id'], 'deliver_appr_reviewer_uniq');
		}
		return $schema;
	}
}
