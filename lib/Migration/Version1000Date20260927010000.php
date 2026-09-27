<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** A drawing on the Frame a Comment anchors to (story 89) */
class Version1000Date20260927010000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_comments');
		if (!$table->hasColumn('annotation')) {
			$table->addColumn('annotation', Types::TEXT, ['notnull' => false]);
		}
		return $schema;
	}
}
