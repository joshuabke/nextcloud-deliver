<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Reviewers belong to the Project (ADR 0017): an address is one of them per
 * Project, so those who share one are merged into the oldest, and the Member
 * who invited a Reviewer is only information now, gone with their account. The
 * address books are asked live, which makes the stored answer obsolete.
 */
class Version1016Date20261028000002 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if (!$table->hasColumn('in_contacts') && !$table->getColumn('owner_uid')->getNotnull()) {
			return null;
		}
		if ($table->hasColumn('in_contacts')) {
			$table->dropColumn('in_contacts');
		}
		$table->getColumn('owner_uid')->setNotnull(false);
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$merged = $this->mergeSameAddress();
		if ($merged > 0) {
			$output->info("Merged $merged Reviewers who share an address with another of their Project.");
		}
	}

	/**
	 * Makes an address one Reviewer per Project (ADR 0017), written on table
	 * and column names alone so that no later change of the app changes this
	 * migration: the Reviewers of a Project who share one, whatever its case,
	 * go into the oldest, who keeps their name. Their places on links move to
	 * it, and where both were on a link, the oldest keeps its row and key, so
	 * the other's Personal Link there stops working. Comments, link activity
	 * move over; of Approvals the newest decision stays, Reactions are not
	 * doubled and the later Unseen mark counts. No Project stays each Member's
	 * own, and removed Reviewers are no one's.
	 *
	 * @return int how many Reviewers went into another
	 */
	public function mergeSameAddress(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'project_id', 'email')->from('deliver_reviewers')
			->where($qb->expr()->isNull('removed_at'))
			->andWhere($qb->expr()->isNotNull('project_id'))
			->andWhere($qb->expr()->isNotNull('email'))
			->orderBy('id');
		$result = $qb->executeQuery();
		$byAddress = [];
		while (($row = $result->fetch()) !== false) {
			$byAddress[$row['project_id'] . ' ' . mb_strtolower(trim((string)$row['email']))][] = (int)$row['id'];
		}
		$result->closeCursor();
		$merged = 0;
		foreach ($byAddress as $ids) {
			$keep = array_shift($ids);
			foreach ($ids as $drop) {
				$this->fold('deliver_reviewer_links', ['token'], $keep, $drop);
				$this->fold('deliver_approvals', ['version_id'], $keep, $drop, 'updated_at', ['status']);
				$this->fold('deliver_reactions', ['comment_id', 'emoji'], $keep, $drop);
				$this->fold('deliver_seen', ['version_id'], $keep, $drop, 'seen_until');
				foreach (['deliver_comments', 'deliver_link_activity'] as $table) {
					$qb = $this->db->getQueryBuilder();
					$qb->update($table)->set('reviewer_id', $qb->createNamedParameter($keep, IQueryBuilder::PARAM_INT))
						->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($drop, IQueryBuilder::PARAM_INT)))
						->executeStatement();
				}
				$qb = $this->db->getQueryBuilder();
				$qb->delete('deliver_reviewers')->where($qb->expr()->eq('id', $qb->createNamedParameter($drop, IQueryBuilder::PARAM_INT)))->executeStatement();
				$merged++;
			}
		}
		return $merged;
	}

	/**
	 * Moves what one Reviewer has in a table to another. Where both have a row
	 * with the same $keys the other's goes: the kept row stays as it is, unless
	 * the dropped one is newer by $newer, then it takes that column and $copy.
	 *
	 * @param list<string> $keys the columns that make a row the same person's twice
	 * @param list<string> $copy columns that go with $newer
	 */
	private function fold(string $table, array $keys, int $keep, int $drop, ?string $newer = null, array $copy = []): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($table)->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($drop, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$rows = $result->fetchAll();
		$result->closeCursor();
		foreach ($rows as $row) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($table)->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($keep, IQueryBuilder::PARAM_INT)));
			foreach ($keys as $key) {
				$qb->andWhere($qb->expr()->eq($key, $qb->createNamedParameter($row[$key], str_ends_with($key, '_id') ? IQueryBuilder::PARAM_INT : IQueryBuilder::PARAM_STR)));
			}
			$result = $qb->executeQuery();
			$kept = $result->fetch();
			$result->closeCursor();
			$qb = $this->db->getQueryBuilder();
			if ($kept === false) {
				$qb->update($table)->set('reviewer_id', $qb->createNamedParameter($keep, IQueryBuilder::PARAM_INT));
			} elseif ($newer !== null && (int)$row[$newer] > (int)$kept[$newer]) {
				$qb->update($table);
				foreach ([$newer, ...$copy] as $column) {
					$qb->set($column, $qb->createNamedParameter($row[$column]));
				}
				$qb->where($qb->expr()->eq('id', $qb->createNamedParameter($kept['id'], IQueryBuilder::PARAM_INT)))->executeStatement();
				$qb = $this->db->getQueryBuilder();
				$qb->delete($table);
			} else {
				$qb->delete($table);
			}
			$qb->where($qb->expr()->eq('id', $qb->createNamedParameter($row['id'], IQueryBuilder::PARAM_INT)))->executeStatement();
		}
	}
}
