<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCA\Deliver\Service\ReviewLink;
use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @template-extends Mapper<Reviewer>
 * @psalm-type Rights = array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool}
 * @psalm-type Place = array{key: string, rights: Rights}
 */
class ReviewerMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_reviewers', Reviewer::class);
	}

	/** @return array<string, string> each of a Reviewer's own rights on a link with its column: canComment, can_comment (ADR 0014) */
	private static function rights(): array {
		return array_combine(ReviewLink::OWN_RIGHTS, array_map(static fn (string $right) => strtolower((string)preg_replace('/[A-Z]/', '_$0', $right)), ReviewLink::OWN_RIGHTS));
	}

	/** The Reviewer whose Personal Link through this link carries this key; removed ones never */
	public function findOnLink(string $token, string $key): ?Reviewer {
		$qb = $this->db->getQueryBuilder();
		$qb->select('r.*')->from($this->getTableName(), 'r')
			->innerJoin('r', 'deliver_reviewer_links', 'l', $qb->expr()->eq('l.reviewer_id', 'r.id'))
			->where($qb->expr()->eq('l.token', $qb->createNamedParameter($token)))
			->andWhere($qb->expr()->eq('l.secret_key', $qb->createNamedParameter($key)))
			->andWhere($qb->expr()->isNull('r.removed_at'));
		return $this->findEntities($qb)[0] ?? null;
	}

	/**
	 * A Project's Reviewers belong to the Project, whoever invited them; on No
	 * Project they are each Member's own (ADR 0017). Narrows a query to either.
	 *
	 * @param ?int $projectId null for No Project
	 * @param list<string> $ownerUids whose No Project, when $projectId is null; unused otherwise
	 */
	private function inProject(IQueryBuilder $qb, ?int $projectId, array $ownerUids): void {
		if ($projectId === null) {
			$qb->andWhere($qb->expr()->isNull('project_id'))
				->andWhere($qb->expr()->in('owner_uid', $qb->createNamedParameter($ownerUids, IQueryBuilder::PARAM_STR_ARRAY)));
		} else {
			$qb->andWhere($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)));
		}
	}

	/**
	 * @param ?int $projectId null for No Project
	 * @param list<string> $ownerUids whose No Project, when $projectId is null
	 * @return Reviewer[] the Reviewers of the Project, or of these Members on No Project, oldest first; removed ones left out
	 */
	public function findInProject(?int $projectId, array $ownerUids): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->isNull('removed_at'))
			->orderBy('created_at')->addOrderBy('id');
		$this->inProject($qb, $projectId, $ownerUids);
		return $this->findEntities($qb);
	}

	/**
	 * A deleted account leaves its Project's Reviewers with the Project, but
	 * no longer as their inviter: the next account of that name is handed the id
	 */
	public function releaseOwner(string $uid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('owner_uid', $qb->createNamedParameter(null, IQueryBuilder::PARAM_NULL))
			->where($qb->expr()->eq('owner_uid', $qb->createNamedParameter($uid)))
			->andWhere($qb->expr()->isNotNull('project_id'))
			->executeStatement();
	}

	/**
	 * Puts the Reviewer on this link with the key of their Personal Link
	 * through it; once is enough
	 *
	 * @return string the key of their Personal Link through it, the one they have if they are on it already
	 */
	public function putOn(int $reviewerId, string $token, string $key, int $at): string {
		$qb = $this->db->getQueryBuilder();
		$qb->insert('deliver_reviewer_links')->values([
			'reviewer_id' => $qb->createNamedParameter($reviewerId),
			'token' => $qb->createNamedParameter($token),
			'secret_key' => $qb->createNamedParameter($key),
			'created_at' => $qb->createNamedParameter($at),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			return $this->keyOn($reviewerId, $token) ?? throw $e;
		}
		return $key;
	}

	/** The key of the Reviewer's Personal Link through this link, null when they are not on it */
	public function keyOn(int $reviewerId, string $token): ?string {
		return $this->placesOfReviewer($reviewerId)[$token]['key'] ?? null;
	}

	/**
	 * Where the Reviewers are: each link they are on, with the key of their
	 * Personal Link through it and their own rights there (ADR 0014)
	 *
	 * @param list<int> $reviewerIds
	 * @return array<int, array<string, Place>> reviewer id → token → their place on it
	 */
	public function placesOf(array $reviewerIds): array {
		if ($reviewerIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token', 'secret_key', ...array_values(self::rights()))->from('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$places = [];
		foreach ($result->fetchAll() as $row) {
			$places[(int)$row['reviewer_id']][(string)$row['token']] = [
				'key' => (string)$row['secret_key'],
				'rights' => array_map(static fn (string $column) => $row[$column] === null ? null : (bool)$row[$column], self::rights()),
			];
		}
		$result->closeCursor();
		return $places;
	}

	/** @return array<string, Place> token → their place, for each link the Reviewer is on */
	public function placesOfReviewer(int $reviewerId): array {
		return $this->placesOf([$reviewerId])[$reviewerId] ?? [];
	}

	/** A new key for the Reviewer's Personal Link through this link */
	public function setKeyOn(int $reviewerId, string $token, string $key): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('deliver_reviewer_links')
			->set('secret_key', $qb->createNamedParameter($key))
			->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($reviewerId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('token', $qb->createNamedParameter($token)))
			->executeStatement();
	}

	/** Takes the Reviewer off one link; their Personal Link through it stops working */
	public function takeOff(int $reviewerId, string $token): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deliver_reviewer_links')
			->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($reviewerId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('token', $qb->createNamedParameter($token)))
			->executeStatement();
	}

	/**
	 * @param ?int $projectId null for No Project
	 * @param string $ownerUid whose No Project, when $projectId is null
	 * @return Reviewer[] the Reviewers of the Project with this address, whatever its case; removed ones left out
	 */
	public function findByAddress(?int $projectId, string $ownerUid, string $email): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq($qb->func()->lower('email'), $qb->createNamedParameter(mb_strtolower($email))))
			->andWhere($qb->expr()->isNull('removed_at'))
			->orderBy('created_at')->addOrderBy('id');
		$this->inProject($qb, $projectId, [$ownerUid]);
		return $this->findEntities($qb);
	}

	/**
	 * The names in a review: a Project's Reviewers are every Member's, while
	 * No Project is each Member's own, so there the Member counts (ADR 0013)
	 *
	 * @param ?int $projectId null for No Project
	 * @param string $ownerUid whose No Project, when $projectId is null
	 * @return list<string> the names of its Reviewers, on a link or not (#75); removed ones and the one excepted left out
	 */
	public function namesIn(?int $projectId, string $ownerUid, ?int $exceptId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('name')->from($this->getTableName())
			->where($qb->expr()->isNull('removed_at'));
		$this->inProject($qb, $projectId, [$ownerUid]);
		if ($exceptId !== null) {
			$qb->andWhere($qb->expr()->neq('id', $qb->createNamedParameter($exceptId, IQueryBuilder::PARAM_INT)));
		}
		$result = $qb->executeQuery();
		$names = [];
		while (($name = $result->fetchOne()) !== false) {
			$names[] = (string)$name;
		}
		$result->closeCursor();
		return $names;
	}

	/** @return ?Rights their own rights on the link, null when they are not on it */
	public function rightsOn(int $reviewerId, string $token): ?array {
		return $this->placesOfReviewer($reviewerId)[$token]['rights'] ?? null;
	}

	/**
	 * The Reviewer's own rights on a link they are on
	 *
	 * @param Rights $rights null: the link decides
	 */
	public function setRightsOn(int $reviewerId, string $token, array $rights): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('deliver_reviewer_links')
			->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($reviewerId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('token', $qb->createNamedParameter($token)));
		foreach (self::rights() as $right => $column) {
			$value = $rights[$right];
			$qb->set($column, $qb->createNamedParameter($value, $value === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_BOOL));
		}
		$qb->executeStatement();
	}

	/**
	 * Deletes a Project's Reviewers with it (story 148). One whose Comments,
	 * Reactions or Approvals live on in another Project, on an Asset moved
	 * there, stays, removed, so that those keep their author's name.
	 */
	public function deleteByProject(int $projectId, int $at): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)));
		$ids = self::ids($qb);
		$elsewhere = [];
		foreach (array_chunk($ids, 1000) as $chunk) {
			$this->deleteLinks($chunk);
			foreach (['deliver_comments', 'deliver_reactions', 'deliver_approvals'] as $table) {
				$qb = $this->db->getQueryBuilder();
				$qb->selectDistinct('reviewer_id')->from($table)
					->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
				$elsewhere = [...$elsewhere, ...self::ids($qb)];
			}
		}
		foreach (array_chunk(array_values(array_diff($ids, $elsewhere)), 1000) as $chunk) {
			foreach (['deliver_seen' => 'reviewer_id', $this->getTableName() => 'id'] as $table => $column) {
				$qb = $this->db->getQueryBuilder();
				$qb->delete($table)
					->where($qb->expr()->in($column, $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
					->executeStatement();
			}
		}
		foreach (array_chunk(array_values(array_unique($elsewhere)), 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->update($this->getTableName())
				->set('removed_at', $qb->createNamedParameter($at, IQueryBuilder::PARAM_INT))
				->where($qb->expr()->in('id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->andWhere($qb->expr()->isNull('removed_at'))
				->executeStatement();
		}
	}

	/**
	 * Makes an address one Reviewer per Project (ADR 0017): the Reviewers of a
	 * Project who share one, whatever its case, go into the oldest, who keeps
	 * their name. Their places on links move to it, and where both were on a
	 * link, the oldest keeps its row and key, so the other's Personal Link
	 * there stops working. Comments, link activity move over; of Approvals the
	 * newest decision stays, Reactions are not doubled and the later Unseen
	 * mark counts. No Project stays each Member's own, and removed Reviewers
	 * are no one's.
	 *
	 * @return int how many Reviewers went into another
	 */
	public function mergeSameAddress(): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'project_id', 'email')->from($this->getTableName())
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
				$this->deleteBy('id', $drop);
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

	/** @return list<int> the first column of what the query finds */
	private static function ids(IQueryBuilder $qb): array {
		$result = $qb->executeQuery();
		$ids = array_map('intval', $result->fetchAll(\PDO::FETCH_COLUMN));
		$result->closeCursor();
		return $ids;
	}

	/** @param list<int> $reviewerIds */
	public function deleteLinks(array $reviewerIds): void {
		if ($reviewerIds === []) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->executeStatement();
	}
}
