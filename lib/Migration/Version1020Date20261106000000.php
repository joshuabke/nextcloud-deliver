<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Whether a Version's Proxy was handed in through the API rather than made by
 * ffmpeg (ADR 0020): such a Proxy keeps ffmpeg from making another, and a
 * Member with Manage may remove it.
 */
class Version1020Date20261106000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$versions = $schema->getTable('deliver_versions');
		if ($versions->hasColumn('proxy_handed_in')) {
			return null;
		}
		$versions->addColumn('proxy_handed_in', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		return $schema;
	}
}
