<?php

declare(strict_types=1);

namespace OCA\Deliver\SetupCheck;

use OCA\Deliver\Service\SupportReport;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\SetupCheck\ISetupCheck;
use OCP\SetupCheck\SetupResult;

/** Deliver makes media and sends reminders in background jobs; on page loads alone they lag */
class BackgroundJobsCheck implements ISetupCheck {
	public function __construct(
		private IAppConfig $appConfig,
		private IL10N $l10n,
	) {
	}

	public function getCategory(): string {
		return 'system';
	}

	public function getName(): string {
		return $this->l10n->t('Deliver background jobs');
	}

	public function run(): SetupResult {
		if (SupportReport::backgroundMode($this->appConfig) === 'cron') {
			return SetupResult::success();
		}
		return SetupResult::warning($this->l10n->t('Background jobs do not run by cron, so Deliver makes Proxies, Thumbnail Strips and Waveforms only while someone has a page open, and Due Date reminders come late. Switch background jobs to Cron.'));
	}
}
