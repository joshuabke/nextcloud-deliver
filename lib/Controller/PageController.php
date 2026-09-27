<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Util;

class PageController extends Controller {
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'deliver-main');
		return new TemplateResponse(Application::APP_ID, 'index');
	}
}
