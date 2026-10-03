<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\AuthPublicShareController;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IRequest;
use OCP\ISession;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/** The review page behind a Share Link or a Project Link */
class PublicController extends AuthPublicShareController {
	use ReviewShareToken;

	public function __construct(
		string $appName,
		IRequest $request,
		ISession $session,
		private IURLGenerator $urls,
		private ReviewLinks $links,
		private ReviewerService $reviewers,
		private IRootFolder $root,
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
		$link = $this->link();
		try {
			$version = match (true) {
				$versionId !== null => $this->links->version($link, $versionId),
				$fileId !== null => $this->links->versionForFile($link, $fileId),
				default => $this->onlyVersion($link),
			};
		} catch (NotFoundException) {
			$version = null;
		}

		$response = new TemplateResponse(Application::APP_ID, 'public', [], TemplateResponse::RENDER_AS_PUBLIC);
		$member = $this->memberUrl($link, $version);
		if ($member !== null) {
			// The parent class wants a TemplateResponse here, so the redirect is made by hand
			$response->setStatus(Http::STATUS_SEE_OTHER);
			$response->addHeader('Location', $member);
			return $response;
		}

		$this->initialState->provideInitialState('token', $this->getToken());
		$this->initialState->provideInitialState('versionId', $version?->getId());
		// For the landing page of a link with several Assets (stories 123, 125)
		$this->initialState->provideInitialState('link', ['title' => $link->title(), 'description' => $link->description()]);
		Util::addScript(Application::APP_ID, 'deliver-public');
		$key = $this->request->getParam('r');
		if (is_string($key) && $key !== '') {
			$this->rememberReviewer($response, $key);
		}
		$cookie = $this->request->getCookie(self::cookieName($this->getToken()));
		$reviewer = $this->reviewers->byKey(is_string($key) && $key !== '' ? $key : (is_string($cookie) ? $cookie : null), $link);
		$this->links->record($link, LinkActivityMapper::OPENED, $reviewer);
		return $response;
	}

	/**
	 * A Member works in the app, never with a Reviewer's reduced rights (story
	 * 59). Whoever can open the file through Files is one (ADR 0009).
	 */
	private function memberUrl(ReviewLink $link, ?Version $version): ?string {
		$user = $this->userSession->getUser();
		$nodeId = $version?->getFileId() ?? $link->memberNodeId();
		if ($user === null || $nodeId === null || $this->root->getUserFolder($user->getUID())->getFirstNodeById($nodeId) === null) {
			return null;
		}
		$app = $this->urls->linkToRoute('deliver.page.index');
		return $version === null ? $app : $app . 'versions/' . $version->getId();
	}

	/**
	 * A link with one Asset opens it in the player; with more, the page shows them as a grid first (story 125).
	 *
	 * @throws NotFoundException not exactly one Asset behind the link
	 */
	private function onlyVersion(ReviewLink $link): Version {
		$assets = $link->assets();
		if (count($assets) !== 1) {
			throw new NotFoundException('More than one Asset, or none');
		}
		return array_values($assets)[0]['versions'][0];
	}

	protected function verifyPassword(string $password): bool {
		return $this->link()->checkPassword($password);
	}
}
