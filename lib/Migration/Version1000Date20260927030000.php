<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Files attached to Comments; the files live in the Project folder (story 92) */
class Version1000Date20260927030000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('deliver_attachments')) {
			$t = $schema->createTable('deliver_attachments');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('comment_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('mime_type', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('size', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['comment_id'], 'deliver_attach_comment');
		}
		return $schema;
	}
}
