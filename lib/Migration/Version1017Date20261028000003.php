<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Project Members (ADR 0016): what a Member with Manage set for a person or a
 * group, and what someone newly given access in Files starts with.
 */
class Version1017Date20261028000003 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$changed = false;
		if (!$schema->hasTable('deliver_members')) {
			$t = $schema->createTable('deliver_members');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
			// user or group
			$t->addColumn('principal_type', Types::STRING, ['notnull' => true, 'length' => 8]);
			$t->addColumn('principal_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			// none, view, comment or manage
			$t->addColumn('level', Types::STRING, ['notnull' => true, 'length' => 8]);
			$t->addColumn('share', Types::BOOLEAN, ['notnull' => false]);
			$t->addColumn('approve', Types::BOOLEAN, ['notnull' => false]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['project_id', 'principal_type', 'principal_id'], 'deliver_member_uniq');
			$changed = true;
		}
		$projects = $schema->getTable('deliver_projects');
		if (!$projects->hasColumn('newcomers')) {
			// view or none; null leaves newcomers as Files has them
			$projects->addColumn('newcomers', Types::STRING, ['notnull' => false, 'length' => 8]);
			$changed = true;
		}
		return $changed ? $schema : null;
	}
}
