<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ShareReviewService;
use OCP\AppFramework\Http\Response;
use OCP\Files\NotFoundException;
use OCP\Share\IShare;

/**
 * The token checks both public controllers share. The framework calls them
 * before any action runs, so password and expiry of the share apply (ADR 0004).
 *
 * @property ShareReviewService $sharing
 */
trait ReviewShareToken {
	/** Cookie that remembers a Reviewer on this browser, one per Share Link */
	public static function cookieName(string $token): string {
		return 'deliver_reviewer_' . $token;
	}

	/** The key never expires: a Reviewer's identity is permanent (spec: Permissions) */
	private function rememberReviewer(Response $response, string $key): void {
		$response->addCookie(self::cookieName($this->getToken()), $key, new \DateTime('+10 years'), 'Lax');
	}

	private function share(): IShare {
		return $this->sharing->byToken($this->getToken());
	}

	/** Only a share a Member switched review on for is a review surface */
	public function isValidToken(): bool {
		try {
			return $this->sharing->isReview($this->share());
		} catch (NotFoundException) {
			return false;
		}
	}

	protected function getPasswordHash(): ?string {
		return $this->share()->getPassword();
	}

	protected function isPasswordProtected(): bool {
		return $this->share()->getPassword() !== null;
	}
}
