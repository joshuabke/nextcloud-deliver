<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Emoji reactions on Comments, one of each kind per person (story 91) */
class Version1000Date20260927020000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('deliver_reactions')) {
			$t = $schema->createTable('deliver_reactions');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('comment_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('emoji', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['comment_id'], 'deliver_react_comment');
			$t->addUniqueIndex(['comment_id', 'user_id', 'emoji'], 'deliver_react_user_uniq');
			$t->addUniqueIndex(['comment_id', 'reviewer_id', 'emoji'], 'deliver_react_reviewer_uniq');
		}
		return $schema;
	}
}
