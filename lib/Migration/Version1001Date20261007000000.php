<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** The language a Reviewer reviews in, so the mails to them come in it too (0.8.3) */
class Version1001Date20261007000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$t = $schema->getTable('deliver_reviewers');
		if ($t->hasColumn('language')) {
			return null;
		}
		// de or en as they picked or their page showed; null: the language of whoever's request sends the mail
		$t->addColumn('language', Types::STRING, ['notnull' => false, 'length' => 8]);
		return $schema;
	}
}
