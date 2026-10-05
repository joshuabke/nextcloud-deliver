<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCA\Deliver\Service\DerivedMedia;
use OCA\Deliver\Service\Reviewable;
use OCA\Deliver\Service\StackService;
use OCA\Files_Trashbin\Events\MoveToTrashEvent;
use OCA\Files_Trashbin\Events\NodeRestoredEvent;
use OCA\Files_Versions\Events\VersionRestoredEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;

/**
 * Keeps Deliver in step with Files (ADR 0002): a new media file in a Folder
 * Project with Auto Intake becomes an Asset, a file written again in place is
 * read again, a file in the trash is Missing,
 * a file deleted for good takes its review data along, and a rename or a move
 * changes only the name: the Version keeps its Project wherever its file goes
 * (ADR 0009).
 *
 * @template-implements IEventListener<Event>
 */
class FileEventsListener implements IEventListener {
	/**
	 * Moving to the trash fires NodeDeletedEvent as well; the trash event marks
	 * the id first so the delete event can tell. Both fire in the same request.
	 *
	 * @var array<int, true>
	 */
	private static array $goingToTrash = [];

	/**
	 * A new file fires NodeWrittenEvent right after NodeCreatedEvent, in the same
	 * request; only a write in a later request is the file written again.
	 *
	 * @var array<int, true>
	 */
	private static array $created = [];

	public function __construct(
		private ProjectMapper $projects,
		private VersionMapper $versions,
		private StackService $stacks,
		private DerivedMedia $media,
	) {
	}

	public function handle(Event $event): void {
		match (true) {
			$event instanceof NodeCreatedEvent => $this->created($event->getNode()),
			$event instanceof NodeWrittenEvent => $this->written($event->getNode()),
			$event instanceof VersionRestoredEvent => $this->rewritten($event->getVersion()->getSourceFile()->getId()),
			$event instanceof NodeRenamedEvent => $this->renamed($event->getSource(), $event->getTarget()),
			$event instanceof MoveToTrashEvent => $this->trashed($event->getNode()),
			$event instanceof NodeRestoredEvent => $this->restored($event->getTarget()),
			$event instanceof NodeDeletedEvent => $this->deleted($event->getNode()),
			default => null,
		};
	}

	/** With Auto Intake a new media file no Project holds becomes an Asset; without it a Member enables files one by one */
	private function arrived(Node $node): void {
		if (!$node instanceof File || !Reviewable::file($node) || $this->versionOf($node) !== null) {
			return;
		}
		$project = $this->projects->findAbove($node);
		if ($project?->getAutoIntake() === true) {
			$this->stacks->intake($project, $node);
		}
	}

	private function created(Node $node): void {
		self::$created[$node->getId()] = true;
		$this->arrived($node);
	}

	private function written(Node $node): void {
		if ($node instanceof File && Reviewable::file($node) && !isset(self::$created[$node->getId()])) {
			$this->rewritten($node->getId());
		}
	}

	/** Written again in place, also by restoring an older file version: same file id, Version and Comments, new content (spec: Delivering again) */
	private function rewritten(int $fileId): void {
		$version = $this->versions->findByFile($fileId);
		if ($version !== null) {
			$this->media->reread($version);
		}
	}

	/** A rename or a move keeps the file id, so the Version stays the same, in the same Project (story 20) */
	private function renamed(Node $source, Node $target): void {
		$version = $this->versionOf($target);
		if ($version === null) {
			// A file no Project holds, moved where Auto Intake may take it
			$this->arrived($target);
			return;
		}
		if ($target instanceof File) {
			$this->stacks->follow($version, $target);
		}
	}

	/** A file in the trash keeps its Comments; the Version is Missing until a restore (story 18) */
	private function trashed(Node $node): void {
		self::$goingToTrash[$node->getId()] = true;
		$version = $this->versionOf($node);
		if ($version !== null) {
			$this->stacks->markMissing($version);
		}
	}

	private function restored(Node $node): void {
		unset(self::$goingToTrash[$node->getId()]);
		$version = $this->versionOf($node);
		if ($version !== null && $node instanceof File) {
			$this->stacks->follow($version, $node);
		}
	}

	/**
	 * Deleted for good: the Version goes with its review data (story 19); a
	 * Folder Project keeps its Assets without its folder (story 11). Versions
	 * inside a deleted folder are purged by the next periodic check.
	 */
	private function deleted(Node $node): void {
		if (isset(self::$goingToTrash[$node->getId()])) {
			unset(self::$goingToTrash[$node->getId()]);
			return;
		}
		$project = $node instanceof Folder ? $this->projects->findByFolderId($node->getId()) : null;
		if ($project !== null) {
			$project->setName($node->getName());
			$project->setFolderId(null);
			$project->setAutoIntake(false);
			$this->projects->update($project);
			return;
		}
		$version = $this->versionOf($node);
		if ($version !== null) {
			$this->stacks->purge($version);
		}
	}

	/** A file is one Version at most (ADR 0009) */
	private function versionOf(Node $node): ?Version {
		return $this->versions->findByFile($node->getId());
	}
}
