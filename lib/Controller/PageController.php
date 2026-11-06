<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Service\Ffmpeg;
use OCA\Deliver\Service\PipelineSettings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
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
		private PipelineSettings $settings,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'deliver-main');
		// The Uploads dialog says which formats need ffmpeg (story 138)
		$this->initialState->provideInitialState('ffmpeg', $this->ffmpeg->available());
		// Where "New Project" makes its folder unless the Member picks another place (story 98)
		$this->initialState->provideInitialState('projectFolder', $this->settings->get()['projectFolder']);
		// Without ffmpeg the uploading browser makes Proxies to the server's rules (ADR 0019)
		$this->initialState->provideInitialState('proxy', $this->settings->proxy());
		$response = new TemplateResponse(Application::APP_ID, 'index');
		// Captions play from a blob the browser converted (#54)
		$response->setContentSecurityPolicy(Application::allowWasm(new ContentSecurityPolicy())->addAllowedMediaDomain('blob:'));
		return $response;
	}
}
