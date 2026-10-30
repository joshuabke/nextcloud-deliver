<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCA\Deliver\Db\ReviewerMapper;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Reviewers belong to the Project (ADR 0017): an address is one of them per
 * Project, so those who share one are merged into the oldest, and the Member
 * who invited a Reviewer is only information now, gone with their account. The
 * address books are asked live, which makes the stored answer obsolete.
 */
class Version1016Date20261028000002 extends SimpleMigrationStep {
	public function __construct(
		private ReviewerMapper $reviewers,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('deliver_reviewers');
		if (!$table->hasColumn('in_contacts') && !$table->getColumn('owner_uid')->getNotnull()) {
			return null;
		}
		if ($table->hasColumn('in_contacts')) {
			$table->dropColumn('in_contacts');
		}
		$table->getColumn('owner_uid')->setNotnull(false);
		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$merged = $this->reviewers->mergeSameAddress();
		if ($merged > 0) {
			$output->info("Merged $merged Reviewers who share an address with another of their Project.");
		}
	}
}
