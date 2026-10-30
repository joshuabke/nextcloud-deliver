<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * What the newcomers setting of a Project was when Deliver first saw a person
 * or a group as a Member of it, so that a later change reaches only those who
 * come after it (ADR 0016).
 */
class Version1018Date20261030000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('deliver_members_seen')) {
			return null;
		}
		$t = $schema->createTable('deliver_members_seen');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
		// user or group
		$t->addColumn('principal_type', Types::STRING, ['notnull' => true, 'length' => 8]);
		$t->addColumn('principal_id', Types::STRING, ['notnull' => true, 'length' => 64]);
		// view or none; null when newcomers were left as Files has them
		$t->addColumn('newcomers', Types::STRING, ['notnull' => false, 'length' => 8]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['project_id', 'principal_type', 'principal_id'], 'deliver_seen_uniq');
		return $schema;
	}
}
