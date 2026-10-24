<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Whether a Reviewer's address is in one of their Member's address books
 * (#66); null until checked, which the Member's next list of them does.
 */
class Version1005Date20261023000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if ($table->hasColumn('in_contacts')) {
			return null;
		}
		$table->addColumn('in_contacts', Types::BOOLEAN, ['notnull' => false]);
		return $schema;
	}
}
