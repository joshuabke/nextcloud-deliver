<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Review Links are Review Links now, in the glossary and in the schema. The
 * links move to a table of that name, in their order; nothing refers to a
 * link's id (Reviewers and activity go by its token), so the new table gives
 * its own. Version1009 drops the old table.
 */
class Version1008Date20261025000000 extends SimpleMigrationStep {
	private const COLUMNS = ['project_id', 'owner_uid', 'token', 'label', 'description', 'password_hash', 'expire_date', 'asset_ids', 'review', 'can_comment', 'allow_older', 'watermark', 'can_download', 'latest_only', 'created_at'];

	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('deliver_review_links')) {
			return null;
		}
		$t = $schema->createTable('deliver_review_links');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$t->addColumn('token', Types::STRING, ['notnull' => true, 'length' => 32]);
		$t->addColumn('label', Types::STRING, ['notnull' => false, 'length' => 255]);
		$t->addColumn('description', Types::TEXT, ['notnull' => false]);
		$t->addColumn('password_hash', Types::STRING, ['notnull' => false, 'length' => 255]);
		// YYYY-MM-DD; the link works through that day
		$t->addColumn('expire_date', Types::STRING, ['notnull' => false, 'length' => 10]);
		// JSON list of Asset ids; null shows the whole Project
		$t->addColumn('asset_ids', Types::TEXT, ['notnull' => false]);
		$t->addColumn('review', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('can_comment', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('allow_older', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('watermark', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('can_download', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('latest_only', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['token'], 'deliver_rlink_token_uniq');
		$t->addIndex(['project_id'], 'deliver_rlink_project_idx');
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('deliver_project_links')) {
			return;
		}
		// In the database itself, so that every column keeps its type on every database
		$columns = implode(', ', self::COLUMNS);
		$this->db->executeStatement("INSERT INTO `*PREFIX*deliver_review_links` ($columns) SELECT $columns FROM `*PREFIX*deliver_project_links` ORDER BY `id`");
	}
}
