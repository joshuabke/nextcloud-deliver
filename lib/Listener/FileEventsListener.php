<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCA\Deliver\Service\StackService;
use OCA\Files_Trashbin\Events\MoveToTrashEvent;
use OCA\Files_Trashbin\Events\NodeRestoredEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;

/**
 * Keeps Deliver in step with Files (ADR 0002): a new media file in a Project
 * with Auto Intake becomes an Asset, a file in the trash is Missing, a file
 * deleted for good takes its review data along, and a rename or a move inside
 * the Project changes only the name.
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

	public function __construct(
		private ProjectMapper $projects,
		private VersionMapper $versions,
		private StackService $stacks,
	) {
	}

	public function handle(Event $event): void {
		match (true) {
			$event instanceof NodeCreatedEvent => $this->arrived($event->getNode()),
			$event instanceof NodeRenamedEvent => $this->renamed($event->getSource(), $event->getTarget()),
			$event instanceof MoveToTrashEvent => $this->trashed($event->getNode()),
			$event instanceof NodeRestoredEvent => $this->restored($event->getTarget()),
			$event instanceof NodeDeletedEvent => $this->deleted($event->getNode()),
			default => null,
		};
	}

	/** With Auto Intake a new media file becomes an Asset; without it a Member enables files one by one */
	private function arrived(Node $node): void {
		$project = $this->projectOf($node);
		if ($node instanceof File && $project?->getAutoIntake() === true && $this->isMedia($node)) {
			$this->stacks->intake($project, $node);
		}
	}

	/** A rename or a move keeps the file id, so the Version stays the same (story 20) */
	private function renamed(Node $source, Node $target): void {
		$version = $this->versionOf($target);
		if ($version === null) {
			// Moved in from outside a Project, where Auto Intake may take it
			$this->arrived($target);
			return;
		}
		$project = $this->projectOf($target);
		if ($project === null || $project->getId() !== $version->getProjectId()) {
			// Moved out of its Project: Missing there, and perhaps an Asset of another
			$this->stacks->markMissing($version);
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
	 * Deleted for good: the Version goes with its review data (story 19), a
	 * Project folder takes the whole Project (story 11). Versions inside a
	 * deleted subfolder are purged by the next scan.
	 */
	private function deleted(Node $node): void {
		if (isset(self::$goingToTrash[$node->getId()])) {
			unset(self::$goingToTrash[$node->getId()]);
			return;
		}
		$project = $node instanceof Folder ? $this->projects->findByFolderId($node->getId()) : null;
		if ($project !== null) {
			$this->stacks->purgeProject($project);
			return;
		}
		$version = $this->versionOf($node);
		if ($version !== null) {
			$this->stacks->purge($version);
		}
	}

	/** A file is one Version at most, since Projects never nest */
	private function versionOf(Node $node): ?Version {
		return $this->versions->findByFile($node->getId())[0] ?? null;
	}

	/** The nearest Project at or above a node */
	private function projectOf(Node $node): ?Project {
		$folder = $node instanceof Folder ? $node : $node->getParent();
		for ($depth = 0; $folder instanceof Folder && $depth < 64; $folder = $folder->getParent(), $depth++) {
			$project = $this->projects->findByFolderId($folder->getId());
			if ($project !== null) {
				return $project;
			}
			if ($folder->getPath() === '' || $folder->getPath() === '/') {
				return null;
			}
		}
		return null;
	}

	private function isMedia(Node $node): bool {
		return preg_match('#^(video|audio)/#', $node->getMimeType()) === 1;
	}
}
