<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Each Personal Link has a key of its own (ADR 0014), kept with the Reviewer
 * on that link. Every link a Reviewer opened, as the activity of the links
 * remembers, has them on it, and each of their links takes the key they had,
 * so that every Personal Link sent before still works. A key is unique per
 * link: a Reviewer from before keeps one key on all of theirs.
 */
class Version1010Date20261026000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewer_links');
		if ($table->hasColumn('secret_key')) {
			return null;
		}
		$table->addColumn('secret_key', Types::STRING, ['notnull' => false, 'length' => 64]);
		$table->addUniqueIndex(['token', 'secret_key'], 'deliver_revlink_key_uniq');
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$reviewers = [];
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'owner_uid', 'project_id', 'secret_key')->from('deliver_reviewers')->where($qb->expr()->isNotNull('secret_key'));
		$result = $qb->executeQuery();
		while (($row = $result->fetch()) !== false) {
			$reviewers[(int)$row['id']] = $row;
		}
		$result->closeCursor();

		// The links of the Reviewer's own Member and Project
		$links = [];
		$qb = $this->db->getQueryBuilder();
		$qb->select('token', 'owner_uid', 'project_id')->from('deliver_review_links');
		$result = $qb->executeQuery();
		while (($row = $result->fetch()) !== false) {
			$links[(string)$row['token']] = $row;
		}
		$result->closeCursor();

		$on = [];
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token')->from('deliver_reviewer_links');
		$result = $qb->executeQuery();
		while (($row = $result->fetch()) !== false) {
			$on[(int)$row['reviewer_id'] . ' ' . $row['token']] = true;
		}
		$result->closeCursor();

		// Who opened a link they are not on yet
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token')->selectAlias($qb->func()->min('created_at'), 'first')
			->from('deliver_link_activity')
			->where($qb->expr()->isNotNull('reviewer_id'))
			->groupBy('reviewer_id', 'token');
		$result = $qb->executeQuery();
		$insert = $this->db->getQueryBuilder();
		$insert->insert('deliver_reviewer_links')->values([
			'reviewer_id' => $insert->createParameter('reviewer'),
			'token' => $insert->createParameter('token'),
			'created_at' => $insert->createParameter('at'),
		]);
		while (($row = $result->fetch()) !== false) {
			$reviewer = $reviewers[(int)$row['reviewer_id']] ?? null;
			$link = $links[(string)$row['token']] ?? null;
			if ($reviewer === null || $link === null || isset($on[(int)$row['reviewer_id'] . ' ' . $row['token']])
				|| $link['owner_uid'] !== $reviewer['owner_uid'] || self::id($link['project_id']) !== self::id($reviewer['project_id'])) {
				continue;
			}
			$insert->setParameter('reviewer', (int)$row['reviewer_id'], IQueryBuilder::PARAM_INT)
				->setParameter('token', (string)$row['token'])
				->setParameter('at', (int)$row['first'], IQueryBuilder::PARAM_INT)
				->executeStatement();
		}
		$result->closeCursor();

		$update = $this->db->getQueryBuilder();
		$update->update('deliver_reviewer_links')
			->set('secret_key', $update->createParameter('key'))
			->where($update->expr()->eq('reviewer_id', $update->createParameter('id')));
		foreach ($reviewers as $id => $reviewer) {
			$update->setParameter('key', (string)$reviewer['secret_key'])->setParameter('id', $id, IQueryBuilder::PARAM_INT)->executeStatement();
		}
	}

	/** A Project id as the driver hands it out, int or string, null for No Project */
	private static function id(mixed $id): ?int {
		return $id === null ? null : (int)$id;
	}
}
