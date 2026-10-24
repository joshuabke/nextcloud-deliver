<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Reviewer> */
class ReviewerMapper extends Mapper {
	/** The rights a Reviewer can have of their own on a link, over the link's (ADR 0014) */
	private const RIGHTS = ['canComment' => 'can_comment', 'allowOlder' => 'allow_older', 'watermark' => 'watermark'];

	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_reviewers', Reviewer::class);
	}

	/** The key of a Personal Link identifies its Reviewer */
	public function findByKey(string $secretKey): ?Reviewer {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('secret_key', $qb->createNamedParameter($secretKey)));
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
			->andWhere($qb->expr()->isNotNull('secret_key'))
			->orderBy('created_at')->addOrderBy('id');
		return $this->findEntities($qb);
	}

	/** Remembers that the Reviewer was invited through or came in by this link, by its token; once is enough */
	public function recordLink(int $reviewerId, string $token, int $at): void {
		$qb = $this->db->getQueryBuilder();
		$qb->insert('deliver_reviewer_links')->values([
			'reviewer_id' => $qb->createNamedParameter($reviewerId),
			'token' => $qb->createNamedParameter($token),
			'created_at' => $qb->createNamedParameter($at),
		]);
		try {
			$qb->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	/**
	 * @param list<int> $reviewerIds
	 * @return array<string, list<int>> link token → the Reviewers who came by it
	 */
	public function reviewersByLink(array $reviewerIds): array {
		if ($reviewerIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token')->from('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$byLink = [];
		foreach ($result->fetchAll() as $row) {
			$byLink[(string)$row['token']][] = (int)$row['reviewer_id'];
		}
		$result->closeCursor();
		return $byLink;
	}

	/** @return Reviewer[] the Member's Reviewers with this address, whatever its case; removed ones left out */
	public function findByAddress(string $ownerUid, string $email): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner_uid', $qb->createNamedParameter($ownerUid)))
			->andWhere($qb->expr()->eq($qb->func()->lower('email'), $qb->createNamedParameter(mb_strtolower($email))))
			->andWhere($qb->expr()->isNotNull('secret_key'))
			->orderBy('created_at')->addOrderBy('id');
		return $this->findEntities($qb);
	}

	/**
	 * @param list<string> $tokens
	 * @return list<string> the names of the Reviewers who came by these links, removed ones and the one excepted left out
	 */
	public function namesByLinks(array $tokens, ?int $exceptId): array {
		if ($tokens === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('r.name')->from($this->getTableName(), 'r')
			->innerJoin('r', 'deliver_reviewer_links', 'l', $qb->expr()->eq('l.reviewer_id', 'r.id'))
			->where($qb->expr()->in('l.token', $qb->createNamedParameter($tokens, IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->isNotNull('r.secret_key'));
		if ($exceptId !== null) {
			$qb->andWhere($qb->expr()->neq('r.id', $qb->createNamedParameter($exceptId, IQueryBuilder::PARAM_INT)));
		}
		$result = $qb->executeQuery();
		$names = [];
		while (($name = $result->fetchOne()) !== false) {
			$names[] = (string)$name;
		}
		$result->closeCursor();
		return $names;
	}

	/**
	 * @param list<int> $reviewerIds
	 * @return array<int, array<string, array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool}>> reviewer id → token → their own rights there, for the links they came by
	 */
	public function rightsByLink(array $reviewerIds): array {
		if ($reviewerIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('reviewer_id', 'token', ...array_values(self::RIGHTS))->from('deliver_reviewer_links')
			->where($qb->expr()->in('reviewer_id', $qb->createNamedParameter($reviewerIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$rights = [];
		foreach ($result->fetchAll() as $row) {
			$rights[(int)$row['reviewer_id']][(string)$row['token']] = array_map(
				static fn (string $column) => $row[$column] === null ? null : (bool)$row[$column],
				self::RIGHTS,
			);
		}
		$result->closeCursor();
		return $rights;
	}

	/** Whether the Reviewer is on the link: invited through it or came by it, so that their Personal Link opens it (ADR 0014) */
	public function isOn(int $reviewerId, string $token): bool {
		return $this->rightsOn($reviewerId, $token) !== null;
	}

	/** @return ?array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool} their own rights on the link, null when they never came by it */
	public function rightsOn(int $reviewerId, string $token): ?array {
		return $this->rightsByLink([$reviewerId])[$reviewerId][$token] ?? null;
	}

	/**
	 * The Reviewer's own rights on a link they came by
	 *
	 * @param array{canComment?: ?bool, allowOlder?: ?bool, watermark?: ?bool} $rights null or left out: the link decides
	 */
	public function setRightsOn(int $reviewerId, string $token, array $rights): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('deliver_reviewer_links')
			->where($qb->expr()->eq('reviewer_id', $qb->createNamedParameter($reviewerId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('token', $qb->createNamedParameter($token)));
		foreach (self::RIGHTS as $right => $column) {
			$value = isset($rights[$right]) ? (bool)$rights[$right] : null;
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
