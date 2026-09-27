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
 * Review state only (ADR 0002): Files stays the source of truth, every file
 * reference is a Nextcloud file id, every anchor is a Frame count.
 * Timestamps are unix seconds.
 *
 * 0.2.0 inherits nothing from 0.1.x: the legacy deliver_comments table
 * (seconds-based timecodes) is dropped, never migrated.
 */
class Version0200Date20260916000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function preSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('deliver_comments') && !$schema->getTable('deliver_comments')->hasColumn('in_frame')) {
			$this->db->dropTable('deliver_comments');
		}
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('deliver_projects')) {
			$t = $schema->createTable('deliver_projects');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('folder_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('auto_intake', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('allow_older', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('fps_num', Types::INTEGER, ['notnull' => true, 'default' => 25]);
			$t->addColumn('fps_den', Types::INTEGER, ['notnull' => true, 'default' => 1]);
			$t->addColumn('timecode_mode', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'smpte']);
			$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['folder_id'], 'deliver_proj_folder_uniq');
		}

		if (!$schema->hasTable('deliver_assets')) {
			$t = $schema->createTable('deliver_assets');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('parent_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('name_override', Types::STRING, ['notnull' => false, 'length' => 255]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['project_id'], 'deliver_asset_project_idx');
		}

		if (!$schema->hasTable('deliver_versions')) {
			$t = $schema->createTable('deliver_versions');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('asset_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('file_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('number', Types::INTEGER, ['notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('fps_num', Types::INTEGER, ['notnull' => false]);
			$t->addColumn('fps_den', Types::INTEGER, ['notnull' => false]);
			$t->addColumn('drop_frame', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('start_frame', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('duration_frames', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('width', Types::INTEGER, ['notnull' => false]);
			$t->addColumn('height', Types::INTEGER, ['notnull' => false]);
			$t->addColumn('has_video', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('has_audio', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'ready']);
			$t->addColumn('auto_stacked', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('playable', Types::BOOLEAN, ['notnull' => false]);
			$t->addColumn('proxy_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
			$t->addColumn('thumbs_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
			$t->addColumn('waveform_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
			$t->addColumn('derived_error', Types::TEXT, ['notnull' => false]);
			$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['project_id', 'file_id'], 'deliver_ver_file_uniq');
			$t->addUniqueIndex(['asset_id', 'number'], 'deliver_ver_asset_num_uniq');
		}

		if (!$schema->hasTable('deliver_comments')) {
			$t = $schema->createTable('deliver_comments');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('version_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('parent_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('in_frame', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('out_frame', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('body', Types::TEXT, ['notnull' => true]);
			$t->addColumn('resolved', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['version_id'], 'deliver_comment_version_idx');
			$t->addIndex(['parent_id'], 'deliver_comment_parent_idx');
		}

		// No table for Share Links: Reviewers arrive through Nextcloud's own shares and
		// Deliver's flags are share attributes (deliver/review, comment, older), ADR 0004.

		if (!$schema->hasTable('deliver_reviewers')) {
			$t = $schema->createTable('deliver_reviewers');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('email', Types::STRING, ['notnull' => false, 'length' => 255]);
			$t->addColumn('secret_key', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['secret_key'], 'deliver_reviewer_key_uniq');
			$t->addIndex(['project_id'], 'deliver_reviewer_project_idx');
		}

		if (!$schema->hasTable('deliver_seen')) {
			$t = $schema->createTable('deliver_seen');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('version_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('seen_until', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			// One mark per person and Version, even when two tabs set it at once
			$t->addUniqueIndex(['version_id', 'user_id'], 'deliver_seen_user_uniq');
			$t->addUniqueIndex(['version_id', 'reviewer_id'], 'deliver_seen_reviewer_uniq');
		}

		if (!$schema->hasTable('deliver_mutes')) {
			$t = $schema->createTable('deliver_mutes');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['project_id', 'user_id'], 'deliver_mute_uniq');
		}

		if (!$schema->hasTable('deliver_jobs')) {
			$t = $schema->createTable('deliver_jobs');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('version_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'queued']);
			$t->addColumn('progress', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('attempts', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('claimed_by', Types::STRING, ['notnull' => false, 'length' => 64]);
			$t->addColumn('stderr_tail', Types::TEXT, ['notnull' => false]);
			$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('started_at', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('finished_at', Types::BIGINT, ['notnull' => false]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['version_id'], 'deliver_job_version_idx');
			$t->addIndex(['state', 'kind'], 'deliver_job_state_idx');
		}

		return $schema;
	}
}
