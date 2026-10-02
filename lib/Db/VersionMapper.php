<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends Mapper<Version> */
class VersionMapper extends Mapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_versions', Version::class);
	}

	/** @return Version[] the Version Stack of one Asset, lowest Version Number first */
	public function findByAsset(int $assetId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->orderBy('number');
		return $this->findEntities($qb);
	}

	/** The top of an Asset's Version Stack: its highest Version Number */
	public function findNewest(int $assetId): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->orderBy('number', 'DESC')
			->setMaxResults(1);
		return $this->findEntities($qb)[0] ?? null;
	}

	/** @return Version[] all Versions of every Asset in the Project, newest Version Number first */
	public function findByProject(int $projectId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->orderBy('number', 'DESC');
		return $this->findEntities($qb);
	}

	/** A file is one Version at most, wherever it lies (ADR 0009) */
	public function findByFile(int $fileId): ?Version {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * @param list<int> $fileIds
	 * @return Version[] the Versions of these files, newest Version Number first
	 */
	public function findByFiles(array $fileIds): array {
		$found = [];
		// Databases cap the length of an IN list
		foreach (array_chunk(array_values(array_unique($fileIds)), 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->in('file_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))
				->orderBy('number', 'DESC');
			array_push($found, ...$this->findEntities($qb));
		}
		return $found;
	}

	/**
	 * @param list<int> $assetIds
	 * @return Version[] all Versions of these Assets, newest Version Number first
	 */
	public function findByAssets(array $assetIds): array {
		if ($assetIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('asset_id', $qb->createNamedParameter($assetIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->orderBy('number', 'DESC');
		return $this->findEntities($qb);
	}

	/** Every Version, for the periodic check of their files */
	public function findAll(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName());
		return $this->findEntities($qb);
	}

	/** Copies an Asset's Project onto its Versions */
	public function setProjectOfAsset(int $assetId, ?int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('project_id', $qb->createNamedParameter($projectId))
			->where($qb->expr()->eq('asset_id', $qb->createNamedParameter($assetId)))
			->executeStatement();
	}

	/** Moves every Version of a Project into No Project, with their Assets */
	public function release(int $projectId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('project_id', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('project_id', $qb->createNamedParameter($projectId)))
			->executeStatement();
	}
}
