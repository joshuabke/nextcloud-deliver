<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\ApprovalMapper;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\Constants;
use OCP\Files\IRootFolder;
use OCP\Files\Lock\ILock;
use OCP\Files\Lock\ILockManager;
use OCP\Files\Lock\LockContext;
use OCP\Files\Node;
use OCP\IAppConfig;
use Psr\Log\LoggerInterface;

/**
 * Deliver's app lock on the file of a Version with Comments or Approvals
 * (ADR 0018), through Nextcloud's lock API (`files_lock`). Overwriting,
 * renaming and deleting the file then fail for everyone outside Deliver;
 * Deliver's own actions run in its lock scope. Without a lock provider every
 * method does nothing. A lock the file's owner lifted in Files stays lifted
 * until the next Comment or Approval changes the Version.
 */
class FileLock {
	public function __construct(
		private ILockManager $locks,
		private IRootFolder $root,
		private CommentMapper $comments,
		private ApprovalMapper $approvals,
		private ProjectMapper $projects,
		private IAppConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/** Whether Nextcloud has a lock provider (`files_lock`), without which Deliver locks nothing */
	public function available(): bool {
		return $this->locks->isLockProviderAvailable();
	}

	/** Brings the lock of a Version's file in line with what it has: locked while it has Comments or Approvals, its Project locks files and it is not in a Deleted Project */
	public function sync(Version $version): void {
		if (!$this->available()) {
			return;
		}
		try {
			$project = $version->getProjectId() === null ? null : $this->projects->find($version->getProjectId());
		} catch (DoesNotExistException) {
			return;
		}
		$wanted = $version->getState() === Version::STATE_READY
			&& !($project?->isDeleted() ?? false)
			&& ($project === null || $project->locksFiles())
			&& ($this->comments->findByVersion($version->getId()) !== [] || $this->approvals->findByVersion($version->getId()) !== []);
		$this->apply($version, $wanted);
	}

	/**
	 * Once, when Deliver first can lock: the Versions that already have Comments
	 * or Approvals get it. Later, a lock the file's owner lifted stays lifted.
	 * Asked by the hourly scan, where Nextcloud has loaded its apps.
	 *
	 * @param iterable<Version> $versions every Version
	 */
	public function lockExisting(iterable $versions): void {
		if ($this->config->getValueBool(Application::APP_ID, 'files_in_review_locked') || !$this->available()) {
			return;
		}
		foreach ($versions as $version) {
			$this->sync($version);
		}
		$this->config->setValueBool(Application::APP_ID, 'files_in_review_locked', true);
	}

	/** Lifts the lock, as the Version leaves Deliver or its Project is deleted */
	public function release(Version $version): void {
		if ($this->locks->isLockProviderAvailable()) {
			$this->apply($version, false);
		}
	}

	/** Runs an action of Deliver's own on a file, which passes the lock; the action's result is returned */
	public function inScope(Node $node, callable $action): mixed {
		$result = null;
		$this->locks->runInScope($this->context($node), static function () use (&$result, $action): void {
			$result = $action();
		});
		return $result;
	}

	/** Whether the running code is in Deliver's lock scope: a write now is Deliver's own */
	public function inOwnScope(): bool {
		return $this->locks->isLockProviderAvailable() && $this->locks->getLockInScope()?->getOwner() === Application::APP_ID;
	}

	private function apply(Version $version, bool $wanted): void {
		try {
			$node = $this->nodeOf($version);
			if ($node === null) {
				return;
			}
			$held = array_filter(
				$this->locks->getLocks($node->getId()),
				static fn (ILock $lock) => $lock->getType() === ILock::TYPE_APP && $lock->getOwner() === Application::APP_ID,
			) !== [];
			if ($wanted && !$held) {
				$this->locks->lock($this->context($node));
			} elseif (!$wanted && $held) {
				$this->locks->unlock($this->context($node));
			}
		} catch (\Throwable $e) {
			// Another holder's lock stays theirs; a lock that fails never fails the Comment
			$this->logger->warning('Deliver could not change the lock of the file of Version ' . $version->getId(), ['exception' => $e]);
		}
	}

	/** The file through someone who may write it, since a Reviewer has no files and read access cannot lock */
	private function nodeOf(Version $version): ?Node {
		foreach ($this->root->getById($version->getFileId()) as $node) {
			if (($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0) {
				return $node;
			}
		}
		return null;
	}

	private function context(Node $node): LockContext {
		return new LockContext($node, ILock::TYPE_APP, Application::APP_ID);
	}
}
