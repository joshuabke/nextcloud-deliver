<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The whole schema. Review state only (ADR 0002): Files stays the source of
 * truth, every file reference is a Nextcloud file id, every anchor is a Frame
 * count. Timestamps are unix seconds. A Project is a collection, its folder
 * optional, and no table stores who may see what (ADR 0009).
 *
 * Until the first release this is the only migration and changes in place;
 * there is no installation to carry forward.
 */
class Version1000Date20260929000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		$t = $schema->createTable('deliver_projects');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		// A Folder Project's folder; null for a Project that only collects
		$t->addColumn('folder_id', Types::BIGINT, ['notnull' => false]);
		// Shown while there is no folder to take the name from
		$t->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 255]);
		$t->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$t->addColumn('auto_intake', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$t->addColumn('allow_older', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		$t->addColumn('fps_num', Types::INTEGER, ['notnull' => true, 'default' => 25]);
		$t->addColumn('fps_den', Types::INTEGER, ['notnull' => true, 'default' => 1]);
		$t->addColumn('timecode_mode', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'smpte']);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['folder_id'], 'deliver_proj_folder_uniq');

		$t = $schema->createTable('deliver_assets');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		// Null: No Project, listed for whoever enabled it
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('enabled_by', Types::STRING, ['notnull' => false, 'length' => 64]);
		$t->addColumn('parent_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('name_override', Types::STRING, ['notnull' => false, 'length' => 255]);
		// A calendar day, YYYY-MM-DD, as the person picked it, and which reminder went out for it (story 93)
		$t->addColumn('due_date', Types::STRING, ['notnull' => false, 'length' => 10]);
		$t->addColumn('due_reminded', Types::STRING, ['notnull' => false, 'length' => 20]);
		$t->setPrimaryKey(['id']);
		$t->addIndex(['project_id'], 'deliver_asset_project_idx');
		$t->addIndex(['enabled_by'], 'deliver_asset_enabled_idx');
		$t->addIndex(['due_date'], 'deliver_asset_due_idx');

		$t = $schema->createTable('deliver_versions');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		// The Asset's Project, copied for the queries by Project; null with the Asset's
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => false]);
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
		// Start, duration and Waveform came from the delivering tool's Sidecar (ADR 0012); the probe leaves them be
		$t->addColumn('sidecar', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('proxy_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
		$t->addColumn('thumbs_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
		$t->addColumn('waveform_state', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => 'none']);
		$t->addColumn('derived_error', Types::TEXT, ['notnull' => false]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		// A file is one Version at most, wherever it lies
		$t->addUniqueIndex(['file_id'], 'deliver_ver_file_uniq');
		$t->addIndex(['project_id'], 'deliver_ver_project_idx');
		$t->addUniqueIndex(['asset_id', 'number'], 'deliver_ver_asset_num_uniq');

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
		// A Drawing on the Frame the Comment anchors to (story 89)
		$t->addColumn('annotation', Types::TEXT, ['notnull' => false]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addIndex(['version_id'], 'deliver_comment_version_idx');
		$t->addIndex(['parent_id'], 'deliver_comment_parent_idx');

		$t = $schema->createTable('deliver_reviewers');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		// The Member who invited them, or whose Project Link they named themselves on
		$t->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
		$t->addColumn('email', Types::STRING, ['notnull' => false, 'length' => 255]);
		// Null once the Reviewer is removed: no Personal Link names them any more, their Comments keep the name
		$t->addColumn('secret_key', Types::STRING, ['notnull' => false, 'length' => 64]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		// What they want mailed: Replies, others' Comments, new Versions; null is the default
		$t->addColumn('mail_replies', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('mail_comments', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('mail_versions', Types::BOOLEAN, ['notnull' => false]);
		// Their own rights over those of the Project Link they come by; null: the link decides
		$t->addColumn('can_comment', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('allow_older', Types::BOOLEAN, ['notnull' => false]);
		$t->addColumn('watermark', Types::BOOLEAN, ['notnull' => false]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['secret_key'], 'deliver_reviewer_key_uniq');
		$t->addIndex(['owner_uid'], 'deliver_reviewer_owner_idx');

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

		// Project 0 is No Project
		$t = $schema->createTable('deliver_mutes');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('project_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['project_id', 'user_id'], 'deliver_mute_uniq');

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

		// Which link a Reviewer was invited through or came in by, a Project Link, by its token
		$t = $schema->createTable('deliver_reviewer_links');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('token', Types::STRING, ['notnull' => true, 'length' => 32]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['reviewer_id', 'token'], 'deliver_revlink_uniq');

		// Review Links: a whole Project or picked Assets; without a Project, picked Assets of No Project (ADR 0011)
		$t = $schema->createTable('deliver_project_links');
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
		$t->addUniqueIndex(['token'], 'deliver_plink_token_uniq');
		$t->addIndex(['project_id'], 'deliver_plink_project_idx');

		// What happened on a link: opened, a Version viewed or downloaded; by token, for both kinds of link
		$t = $schema->createTable('deliver_link_activity');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('token', Types::STRING, ['notnull' => true, 'length' => 32]);
		$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 16]);
		$t->addColumn('version_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('created_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addIndex(['token'], 'deliver_activity_token_idx');

		// Approvals: one decision per person and Version (story 88)
		$t = $schema->createTable('deliver_approvals');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('version_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
		$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16]);
		$t->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['version_id', 'user_id'], 'deliver_appr_user_uniq');
		$t->addUniqueIndex(['version_id', 'reviewer_id'], 'deliver_appr_reviewer_uniq');

		// Reactions: one of each emoji per person and Comment (story 91)
		$t = $schema->createTable('deliver_reactions');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('comment_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
		$t->addColumn('reviewer_id', Types::BIGINT, ['notnull' => false]);
		$t->addColumn('emoji', Types::STRING, ['notnull' => true, 'length' => 16]);
		$t->setPrimaryKey(['id']);
		$t->addUniqueIndex(['comment_id', 'user_id', 'emoji'], 'deliver_react_user_uniq');
		$t->addUniqueIndex(['comment_id', 'reviewer_id', 'emoji'], 'deliver_react_reviewer_uniq');

		// Attachments: files attached to Comments, kept in app data under the Comment (story 92)
		$t = $schema->createTable('deliver_attachments');
		$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
		$t->addColumn('comment_id', Types::BIGINT, ['notnull' => true]);
		$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
		$t->addColumn('mime_type', Types::STRING, ['notnull' => true, 'length' => 255]);
		$t->addColumn('size', Types::BIGINT, ['notnull' => true]);
		$t->setPrimaryKey(['id']);
		$t->addIndex(['comment_id'], 'deliver_attach_comment');

		return $schema;
	}
}
