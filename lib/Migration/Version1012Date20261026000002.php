<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The keys live on each Reviewer's links now (Version1010, 1011) */
class Version1012Date20261026000002 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if (!$table->hasColumn('secret_key')) {
			return null;
		}
		if ($table->hasIndex('deliver_reviewer_key_uniq')) {
			$table->dropIndex('deliver_reviewer_key_uniq');
		}
		$table->dropColumn('secret_key');
		return $schema;
	}
}
