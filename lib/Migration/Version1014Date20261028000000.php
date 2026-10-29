<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Each Version records who delivered it; null for what no account's request brought */
class Version1014Date20261028000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_versions');
		if ($table->hasColumn('delivered_by')) {
			return null;
		}
		$table->addColumn('delivered_by', Types::STRING, ['notnull' => false, 'length' => 64]);
		return $schema;
	}
}
