<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Service\Ffmpeg;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IInitialState $initialState,
		private Ffmpeg $ffmpeg,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'deliver-main');
		// The Uploads dialog says which formats need ffmpeg (story 138)
		$this->initialState->provideInitialState('ffmpeg', $this->ffmpeg->available());
		return new TemplateResponse(Application::APP_ID, 'index');
	}
}
