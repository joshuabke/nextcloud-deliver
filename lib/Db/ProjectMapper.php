<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IDBConnection;

/** @template-extends QBMapper<Project> */
class ProjectMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'deliver_projects', Project::class);
	}

	/** @return Project[] */
	public function findAll(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())->orderBy('created_at', 'DESC');
		return $this->findEntities($qb);
	}

	/** @throws DoesNotExistException */
	public function find(int $id): Project {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		return $this->findEntity($qb);
	}

	/** @return Project[] the Deleted Projects, the longest deleted first */
	public function findDeleted(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->isNotNull('deleted_at'))
			->orderBy('deleted_at');
		return $this->findEntities($qb);
	}

	/** Whether the Project is a Deleted Project; a Project deleted for good is none */
	public function isDeleted(?int $id): bool {
		if ($id === null) {
			return false;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->isNotNull('deleted_at'));
		$result = $qb->executeQuery();
		$found = $result->fetchOne() !== false;
		$result->closeCursor();
		return $found;
	}

	public function findByFolderId(int $folderId): ?Project {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('folder_id', $qb->createNamedParameter($folderId)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** The nearest Project at or above a node: the node itself when it is a folder, else from its folder up */
	public function findAbove(Node $node): ?Project {
		for ($folder = $node instanceof Folder ? $node : $node->getParent(); $folder instanceof Folder; $folder = $folder->getParent()) {
			$project = $this->findByFolderId($folder->getId());
			if ($project !== null || $folder->getPath() === '' || $folder->getPath() === '/') {
				return $project;
			}
		}
		return null;
	}
}
