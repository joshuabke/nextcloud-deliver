<?php

declare(strict_types=1);

namespace OCA\Deliver\Settings;

use OCA\Deliver\AppInfo\Application;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

/** The derived-media settings in the admin area; the form loads its values over OCS */
class Admin implements ISettings {
	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'deliver-admin');
		return new TemplateResponse(Application::APP_ID, 'admin', [], TemplateResponse::RENDER_AS_BLANK);
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}
}
