<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** A Due Date per Asset, and which reminder went out for it (story 93) */
class Version1000Date20260927040000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_assets');
		if (!$table->hasColumn('due_date')) {
			// A calendar day, YYYY-MM-DD, as the person picked it
			$table->addColumn('due_date', Types::STRING, ['notnull' => false, 'length' => 10]);
			$table->addColumn('due_reminded', Types::STRING, ['notnull' => false, 'length' => 20]);
			$table->addIndex(['due_date'], 'deliver_asset_due_idx');
		}
		return $schema;
	}
}
