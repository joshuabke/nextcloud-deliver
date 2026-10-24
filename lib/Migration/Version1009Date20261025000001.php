<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The links live in deliver_review_links now (Version1008) */
class Version1009Date20261025000001 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('deliver_project_links')) {
			return null;
		}
		$schema->dropTable('deliver_project_links');
		return $schema;
	}
}
