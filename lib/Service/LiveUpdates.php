<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCP\AppFramework\Db\DoesNotExistException;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Tells the Members' open Review views that a Version's Comments, reactions
 * or approvals changed (story 96), through the notify_push app where it
 * runs; they then ask for the changes at once instead of at their next poll.
 * Without notify_push, and for Reviewers, polling is all there is.
 */
class LiveUpdates {
	public const MESSAGE = 'deliver_changed';
	private const QUEUE = 'OCA\\NotifyPush\\Queue\\IQueue';

	public function __construct(
		private ProjectMapper $projects,
		private Members $members,
		private ContainerInterface $container,
		private LoggerInterface $logger,
	) {
	}

	public function changed(Version $version): void {
		$queue = $this->queue();
		if ($queue === null) {
			return;
		}
		try {
			$folderId = $this->projects->find($version->getProjectId())->getFolderId();
		} catch (DoesNotExistException) {
			return;
		}
		foreach ($this->members->of($folderId) as $uid) {
			try {
				$queue->push('notify_custom', ['user' => $uid, 'message' => self::MESSAGE, 'body' => ['versionId' => $version->getId()]]);
			} catch (\Throwable $e) {
				// A push that does not arrive costs a few seconds, never the change itself
				$this->logger->info('notify_push did not take the update', ['exception' => $e]);
				return;
			}
		}
	}

	/** notify_push's queue, or null where the app is not there */
	private function queue(): ?object {
		if (!interface_exists(self::QUEUE)) {
			return null;
		}
		try {
			$queue = $this->container->get(self::QUEUE);
			return is_object($queue) && method_exists($queue, 'push') ? $queue : null;
		} catch (\Throwable) {
			return null;
		}
	}
}
