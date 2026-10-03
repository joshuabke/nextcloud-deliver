<?php

declare(strict_types=1);

namespace OCA\Deliver\Listener;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Controller\PublicController;
use OCA\Deliver\Service\ReviewLinks;
use OCA\Deliver\Service\ShareReviewService;
use OCA\Files_Sharing\Event\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\File;
use OCP\Files\NotFoundException;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;

/**
 * Adds Deliver to Nextcloud's own public share page when the share has review
 * on (ADR 0004): a Review button on every file that is an Asset, or straight
 * into the review view when the link points at one enabled file (story 48).
 * A share without the flag loads nothing of Deliver's.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class LoadPublicSharePageListener implements IEventListener {
	public function __construct(
		private ShareReviewService $sharing,
		private ReviewLinks $links,
		private IInitialState $initialState,
		private IRequest $request,
		private IURLGenerator $urls,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent || $event->getScope() !== null) {
			return;
		}
		$share = $event->getShare();
		if (!$this->sharing->isReview($share)) {
			return;
		}
		$token = $share->getToken();

		// A Personal Link is this page plus the Reviewer's key (story 53)
		$key = $this->request->getParam('r');
		if (is_string($key) && $key !== '') {
			setcookie(PublicController::cookieName($token), $key, [
				'expires' => time() + 10 * 365 * 24 * 3600,
				'path' => $this->urls->getWebroot() ?: '/',
				'secure' => $this->request->getServerProtocol() === 'https',
				'httponly' => true,
				'samesite' => 'Lax',
			]);
		}

		$reviewUrl = null;
		try {
			$node = $share->getNode();
			if ($node instanceof File) {
				$version = $this->links->versionForFile($this->sharing->wrap($share), $node->getId());
				$reviewUrl = $this->urls->linkToRoute('deliver.Public.showVersion', ['token' => $token, 'versionId' => $version->getId()]);
			}
		} catch (NotFoundException) {
			// not enabled for review: the share page stays as it is
		}

		$this->initialState->provideInitialState('token', $token);
		// Initial state takes no null; the script's default stands for it
		if ($reviewUrl !== null) {
			$this->initialState->provideInitialState('reviewUrl', $reviewUrl);
		}
		// An init script runs before the file list asks for its actions; a regular one would be too late
		Util::addInitScript(Application::APP_ID, 'deliver-publicfiles');
	}
}
