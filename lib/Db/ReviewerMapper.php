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
	 * @param list<string> $uids
	 * @return Reviewer[] the Reviewers of these Members, oldest first; removed ones left out
	 */
	public function findByOwners(array $uids): array {
		if ($uids === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('owner_uid', $qb->createNamedParameter($uids, IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->isNull('removed_at'))
			->orderBy('created_at')->addOrderBy('id');
		return $this->findEntities($qb);
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

	/** @return Reviewer[] the Member's Reviewers with this address, whatever its case; removed ones left out */
	public function findByAddress(string $ownerUid, string $email): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)))
			->andWhere($qb->expr()->eq($qb->func()->lower('email'), $qb->createNamedParameter(mb_strtolower($email))))
			->andWhere($qb->expr()->isNull('removed_at'))
			->orderBy('created_at')->addOrderBy('id');
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
		if ($projectId === null) {
			$qb->andWhere($qb->expr()->isNull('project_id'))
				->andWhere($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)));
		} else {
			$qb->andWhere($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId, IQueryBuilder::PARAM_INT)));
		}
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
