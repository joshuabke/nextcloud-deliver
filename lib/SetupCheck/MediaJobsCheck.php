<?php

declare(strict_types=1);

namespace OCA\Deliver\SetupCheck;

use OCA\Deliver\Db\Job;
use OCA\Deliver\Db\JobMapper;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\SetupCheck\ISetupCheck;
use OCP\SetupCheck\SetupResult;

/** Failed media jobs, with the way to the admin panel that shows and retries them */
class MediaJobsCheck implements ISetupCheck {
	public function __construct(
		private JobMapper $jobs,
		private IL10N $l10n,
		private IURLGenerator $urls,
	) {
	}

	public function getCategory(): string {
		return 'system';
	}

	public function getName(): string {
		return $this->l10n->t('Deliver media jobs');
	}

	public function run(): SetupResult {
		$failed = $this->jobs->countByState()[Job::STATE_FAILED] ?? 0;
		if ($failed === 0) {
			return SetupResult::success();
		}
		return SetupResult::warning(
			$this->l10n->n('%n media job failed. The Deliver admin settings show why and retry it.', '%n media jobs failed. The Deliver admin settings show why and retry them.', $failed),
			$this->urls->linkToRouteAbsolute('settings.AdminSettings.index', ['section' => 'deliver']),
		);
	}
}
