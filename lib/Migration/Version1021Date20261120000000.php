<?php

declare(strict_types=1);

namespace OCA\Deliver\Migration;

use Closure;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Waveforms have peaks at a fixed rate now (ADR 0021): every one made
 * before counts as missing and is made again, with ffmpeg by the hourly scan
 * (DerivedMedia::queueMissingWaveforms), without it by the browser.
 * A failed one stays failed, for the admin to retry. Its old file stays in
 * app data until the new one takes its name.
 */
class Version1021Date20261120000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('deliver_versions')
			->set('waveform_state', $qb->createNamedParameter('none'))
			->where($qb->expr()->eq('waveform_state', $qb->createNamedParameter('ready')))
			->executeStatement();
	}
}
