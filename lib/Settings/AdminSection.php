<?php

declare(strict_types=1);

namespace OCA\Deliver\Settings;

use OCA\Deliver\AppInfo\Application;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class AdminSection implements IIconSection {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $urls,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l->t('Deliver');
	}

	public function getPriority(): int {
		return 80;
	}

	public function getIcon(): string {
		return $this->urls->imagePath(Application::APP_ID, 'app.svg');
	}
}
