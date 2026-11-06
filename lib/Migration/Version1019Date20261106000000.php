<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The state of a Version's Scrub Proxy, next to those of its other derived media (#169) */
class Version1019Date20261106000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$versions = $schema->getTable('deliver_versions');
		if ($versions->hasColumn('scrub_state')) {
			return null;
		}
		$versions->addColumn('scrub_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
		return $schema;
	}
}
