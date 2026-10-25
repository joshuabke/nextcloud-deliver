<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** A deleted Project is kept as a Deleted Project for a while before it goes for good (ADR 0015) */
class Version1013Date20261027000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_projects');
		if ($table->hasColumn('deleted_at')) {
			return null;
		}
		// Both null while the Project is in use
		$table->addColumn('deleted_at', Types::BIGINT, ['notnull' => false]);
		$table->addColumn('deleted_by', Types::STRING, ['notnull' => false, 'length' => 64]);
		return $schema;
	}
}
