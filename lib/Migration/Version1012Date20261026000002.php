<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The keys live on each Reviewer's links now (Version1010, 1011): unique per
 * link, now that every link has its keys, and gone from the Reviewer
 */
class Version1012Date20261026000002 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$links = $schema->getTable('deliver_reviewer_links');
		$table = $schema->getTable('deliver_reviewers');
		if ($links->hasIndex('deliver_revlink_key_uniq') && !$table->hasColumn('secret_key')) {
			return null;
		}
		if (!$links->hasIndex('deliver_revlink_key_uniq')) {
			$links->addUniqueIndex(['token', 'secret_key'], 'deliver_revlink_key_uniq');
		}
		if (!$table->hasColumn('secret_key')) {
			return $schema;
		}
		if ($table->hasIndex('deliver_reviewer_key_uniq')) {
			$table->dropIndex('deliver_reviewer_key_uniq');
		}
		$table->dropColumn('secret_key');
		return $schema;
	}
}
