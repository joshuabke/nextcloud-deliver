<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ShareReviewService;
use OCP\AppFramework\AuthPublicShareController;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Files\NotFoundException;
use OCP\IRequest;
use OCP\ISession;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Share\IShare;
use OCP\Util;

/** The review page behind a Share Link */
class PublicController extends AuthPublicShareController {
	use ReviewShareToken;

	public function __construct(
		string $appName,
		IRequest $request,
		ISession $session,
		private IURLGenerator $urls,
		private ShareReviewService $sharing,
		private ProjectService $projects,
		private IUserSession $userSession,
		private IInitialState $initialState,
	) {
		parent::__construct($appName, $request, $session, $urls);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function showShare(): TemplateResponse {
		$fileId = $this->request->getParam('fileId');
		return $this->page($fileId === null ? null : (int)$fileId, null);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function showVersion(int $versionId): TemplateResponse {
		return $this->page(null, $versionId);
	}

	private function page(?int $fileId, ?int $versionId): TemplateResponse {
		$share = $this->share();
		try {
			$version = match (true) {
				$versionId !== null => $this->sharing->version($share, $versionId),
				$fileId !== null => $this->sharing->versionForFile($share, $fileId),
				default => $this->firstVersion($share),
			};
		} catch (NotFoundException) {
			$version = null;
		}

		$response = new TemplateResponse(Application::APP_ID, 'public', [], TemplateResponse::RENDER_AS_PUBLIC);
		$member = $this->memberUrl($share, $version);
		if ($member !== null) {
			// The parent class wants a TemplateResponse here, so the redirect is made by hand
			$response->setStatus(Http::STATUS_SEE_OTHER);
			$response->addHeader('Location', $member);
			return $response;
		}

		$this->initialState->provideInitialState('token', $this->getToken());
		$this->initialState->provideInitialState('versionId', $version?->getId());
		Util::addScript(Application::APP_ID, 'deliver-public');
		$key = $this->request->getParam('r');
		if (is_string($key) && $key !== '') {
			$this->rememberReviewer($response, $key);
		}
		return $response;
	}

	/** A Member works in the app, never with a Reviewer's reduced rights (story 59) */
	private function memberUrl(IShare $share, ?Version $version): ?string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return null;
		}
		try {
			$this->projects->resolve($user->getUID(), $this->sharing->project($share)->getId());
		} catch (NotFoundException) {
			return null;
		}
		$app = $this->urls->linkToRoute('deliver.page.index');
		return $version === null ? $app : $app . 'versions/' . $version->getId();
	}

	/** @throws NotFoundException the Share Link shows no Asset */
	private function firstVersion(IShare $share): Version {
		foreach ($this->sharing->assets($share) as ['versions' => $versions]) {
			return $versions[0];
		}
		throw new NotFoundException('Nothing to review behind this link');
	}

	protected function verifyPassword(string $password): bool {
		return $this->sharing->checkPassword($this->share(), $password);
	}
}
