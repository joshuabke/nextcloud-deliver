<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Files in review are locked, a Project setting switches it off, and an overwrite under Comments is marked (ADR 0018) */
class Version1015Date20261028000001 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$projects = $schema->getTable('deliver_projects');
		if ($projects->hasColumn('lock_files')) {
			return null;
		}
		$projects->addColumn('lock_files', Types::BOOLEAN, ['notnull' => false, 'default' => true]);
		// Null while the file was never overwritten under Comments
		$schema->getTable('deliver_versions')->addColumn('overwritten_at', Types::BIGINT, ['notnull' => false]);
		return $schema;
	}
}
