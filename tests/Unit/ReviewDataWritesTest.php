<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * A Version's file is locked while it has Comments or Approvals (ADR 0018),
 * and the lock hears of them only through their mappers (ReviewDataMapper).
 * This reads the code: whatever adds or removes them elsewhere would leave
 * the lock behind, so it has to go through those mappers or onto a list
 * below that says why it may not.
 */
class ReviewDataWritesTest extends TestCase {
	private const MAPPERS = ['Db/CommentMapper.php', 'Db/ApprovalMapper.php', 'Db/ReviewDataMapper.php'];

	/** Code that names the tables without adding or removing rows */
	private const NAMING_THE_TABLES = [
		'Db/AttachmentMapper.php' => 'joins Comments to read Attachments',
		'Db/ReviewerMapper.php' => 'looks up which Reviewers wrote any',
		'Listener/UserDeletedListener.php' => 'blanks the author of a deleted account',
	];

	/** Bulk deletes through the mappers, which do not tell the lock */
	private const BULK_DELETES = [
		'Service/StackService.php' => 'purge, which releases the lock itself',
	];

	public function testCommentsAndApprovalsComeAndGoOnlyThroughTheirMappers(): void {
		$lib = dirname(__DIR__, 2) . '/lib/';
		$files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($lib, \FilesystemIterator::SKIP_DOTS));
		$found = [];
		foreach ($files as $file) {
			$path = substr($file->getPathname(), strlen($lib));
			// A shipped migration works on tables as they were, before any lock
			if (!str_ends_with($path, '.php') || str_starts_with($path, 'Migration/') || in_array($path, self::MAPPERS, true)) {
				continue;
			}
			$code = file_get_contents($file->getPathname());
			if (preg_match("/['\"]deliver_(comments|approvals)['\"]/", $code) === 1 && !isset(self::NAMING_THE_TABLES[$path])) {
				$found[] = "$path names the Comment or Approval table";
			}
			if (preg_match('/->(insert|delete)\(\s*[\'"]deliver_(comments|approvals)[\'"]/', $code) === 1) {
				$found[] = "$path adds or removes Comments or Approvals by query";
			}
			if (preg_match('/->(comments|approvals)->deleteBy\(/', $code) === 1 && !isset(self::BULK_DELETES[$path])) {
				$found[] = "$path deletes Comments or Approvals in bulk";
			}
		}
		self::assertSame([], $found, 'Go through CommentMapper or ApprovalMapper so the file lock follows, or list the file here with the reason it may not');
	}
}
