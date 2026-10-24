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
 * remembers, has them on it with the rights of their own they have on their
 * other links, and each of their links takes the key they had, so that the
 * Personal Links they used still work. A Reviewer from before keeps one key
 * on all of theirs; Version1012 makes a key unique per link once all are set.
 */
class Version1010Date20261026000000 extends SimpleMigrationStep {
	private const RIGHTS = ['can_comment', 'allow_older', 'watermark'];

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
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->getTable('deliver_reviewers')->hasColumn('secret_key')) {
			return;
		}
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

		// Where they are already, and the rights of their own they have there: Version1006 gave each of their links the same
		$on = [];
		$rights = [];
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token', ...self::RIGHTS)->from('deliver_reviewer_links');
		$result = $qb->executeQuery();
		while (($row = $result->fetch()) !== false) {
			$on[(int)$row['reviewer_id'] . ' ' . $row['token']] = true;
			$rights[(int)$row['reviewer_id']] ??= array_intersect_key($row, array_flip(self::RIGHTS));
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
			'secret_key' => $insert->createParameter('key'),
			'created_at' => $insert->createParameter('at'),
		] + array_combine(self::RIGHTS, array_map(static fn (string $right) => $insert->createParameter($right), self::RIGHTS)));
		while (($row = $result->fetch()) !== false) {
			$reviewer = $reviewers[(int)$row['reviewer_id']] ?? null;
			$link = $links[(string)$row['token']] ?? null;
			if ($reviewer === null || $link === null || isset($on[(int)$row['reviewer_id'] . ' ' . $row['token']])
				|| $link['owner_uid'] !== $reviewer['owner_uid'] || self::id($link['project_id']) !== self::id($reviewer['project_id'])) {
				continue;
			}
			$insert->setParameter('reviewer', (int)$row['reviewer_id'], IQueryBuilder::PARAM_INT)
				->setParameter('token', (string)$row['token'])
				->setParameter('key', (string)$reviewer['secret_key'])
				->setParameter('at', (int)$row['first'], IQueryBuilder::PARAM_INT);
			foreach (self::RIGHTS as $right) {
				$value = $rights[(int)$row['reviewer_id']][$right] ?? null;
				$insert->setParameter($right, $value === null ? null : (bool)$value, $value === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_BOOL);
			}
			$insert->executeStatement();
			$on[(int)$row['reviewer_id'] . ' ' . $row['token']] = true;
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
