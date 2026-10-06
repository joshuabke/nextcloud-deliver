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
use OCP\Files\NotFoundException;
use OCP\IRequest;
use OCP\ISession;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Util;

/** The review page behind a Project Link (ADR 0011) */
class PublicController extends AuthPublicShareController {
	use ReviewLinkToken;

	/** Set by the page itself when a Reviewer picks German or English (src/lib/language.js) */
	private const LANGUAGE_COOKIE = 'deliver_language';

	public function __construct(
		string $appName,
		IRequest $request,
		ISession $session,
		private IURLGenerator $urls,
		private ReviewLinks $links,
		private ReviewerService $reviewers,
		private IUserSession $userSession,
		private IInitialState $initialState,
	) {
		parent::__construct($appName, $request, $session, $urls);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function showShare(): TemplateResponse {
		return $this->page(null);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function showVersion(int $versionId): TemplateResponse {
		return $this->page($versionId);
	}

	private function page(?int $versionId): TemplateResponse {
		// The language a Reviewer chose on this browser goes into the address, before anything is recorded
		$language = $this->request->getCookie(self::LANGUAGE_COOKIE);
		if (in_array($language, ['de', 'en'], true) && $this->request->getParam('forceLanguage') === null) {
			$uri = $this->request->getRequestUri();
			$response = new TemplateResponse(Application::APP_ID, 'public', [], TemplateResponse::RENDER_AS_BLANK);
			$response->setStatus(Http::STATUS_SEE_OTHER);
			$response->addHeader('Location', $uri . (str_contains($uri, '?') ? '&' : '?') . 'forceLanguage=' . $language);
			return $response;
		}
		$link = $this->link();
		try {
			$version = $versionId === null ? $this->onlyVersion($link) : $this->links->version($link, $versionId);
		} catch (NotFoundException) {
			$version = null;
		}

		$response = new TemplateResponse(Application::APP_ID, 'public', [], TemplateResponse::RENDER_AS_PUBLIC);
		// A Member of what the page shows previews it, and is no Reviewer opening it, whichever key comes along (story 59)
		$shown = $version === null ? array_column(array_column($link->assets(), 'versions'), 0) : [$version];
		$member = $this->links->isMember($this->userSession->getUser()?->getUID(), ...$shown);

		$reviewer = null;
		if (!$member) {
			$key = $this->request->getParam('r');
			if (is_string($key) && $key !== '') {
				$this->rememberReviewer($response, $key);
			}
			$cookie = $this->request->getCookie(self::cookieName($this->getToken()));
			$reviewer = $this->reviewers->byKey(is_string($key) && $key !== '' ? $key : (is_string($cookie) ? $cookie : null), $link);
			$this->links->record($link, LinkActivityMapper::OPENED, $reviewer);
		}

		$this->initialState->provideInitialState('token', $this->getToken());
		// Nextcloud logs a warning for null, so a landing page gives none
		if ($version !== null) {
			$this->initialState->provideInitialState('versionId', $version->getId());
		}
		// For the landing page of a link with several Assets (stories 123, 125)
		$flags = $reviewer === null ? $link->flags() : $reviewer->over($link->flags());
		$this->initialState->provideInitialState('link', [
			'title' => $link->title(),
			'description' => $link->description(),
			// What the Reviewer's menu shows, not their key
			'reviewer' => $reviewer === null ? null : ['id' => $reviewer->getId(), 'name' => $reviewer->getName(), 'email' => $reviewer->getEmail(), 'mail' => $reviewer->mailWishes()],
			'downloadAll' => $flags['canDownload'] ? $this->urls->linkToRoute('deliver.PublicApi.download', ['token' => $this->getToken()]) : null,
			// The landing of a Member's preview leads into the app; in the player, the context of each Version does (story 59)
			'memberUrl' => $member && $version === null ? $this->urls->linkToRoute('deliver.page.index') : null,
		]);
		Util::addScript(Application::APP_ID, 'deliver-public');
		return $response;
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
