<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The Reviewer's own rights now live on each link they come by (Version1006, ADR 0014) */
class Version1007Date20261024000001 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if (!$table->hasColumn('can_comment')) {
			return null;
		}
		foreach (['can_comment', 'allow_older', 'watermark'] as $right) {
			$table->dropColumn($right);
		}
		return $schema;
	}
}
