<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCA\Deliver\Event\ReviewDataChanged;
use OCP\AppFramework\Db\Entity;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IDBConnection;

/**
 * The mapper of what a Version's file lock depends on: Comments and Approvals.
 * Every one added or removed through it tells the lock (ADR 0018), so a new
 * code path cannot forget to. Changing a row in place keeps what the Version
 * has, and deleting all of a Version's at once is its purge, which releases
 * the lock itself; neither tells anything.
 *
 * @template T of Comment|Approval
 * @template-extends Mapper<T>
 */
abstract class ReviewDataMapper extends Mapper {
	public function __construct(
		IDBConnection $db,
		string $table,
		string $entityClass,
		private IEventDispatcher $events,
	) {
		parent::__construct($db, $table, $entityClass);
	}

	/**
	 * @param T $entity
	 * @return T
	 */
	public function insert(Entity $entity): Entity {
		$entity = parent::insert($entity);
		$this->changed($entity->getVersionId());
		return $entity;
	}

	/**
	 * @param T $entity
	 * @return T
	 */
	public function delete(Entity $entity): Entity {
		$entity = parent::delete($entity);
		$this->changed($entity->getVersionId());
		return $entity;
	}

	private function changed(int $versionId): void {
		$this->events->dispatchTyped(new ReviewDataChanged($versionId));
	}
}
