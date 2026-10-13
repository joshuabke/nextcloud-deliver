<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The files a Member removed from a Folder Project, which Auto Intake leaves out (story 132) */
class Version1002Date20261010000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('deliver_removed')) {
			return null;
		}
		$t = $schema->createTable('deliver_removed');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['project_id', 'file_id'], 'deliver_removed_uniq');
		return $schema;
	}
}
