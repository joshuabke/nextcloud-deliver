<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http\Response;
use OCP\Files\NotFoundException;

/**
 * The token checks both public controllers share. The framework calls them
 * before any action runs, so password and expiry of the Review Link apply
 * (ADR 0011).
 *
 * @property ReviewLinks $links
 */
trait ReviewLinkToken {
	private ?ReviewLink $resolved = null;

	/** Cookie that remembers a Reviewer on this browser, one per link */
	public static function cookieName(string $token): string {
		return 'deliver_reviewer_' . $token;
	}

	/** The key never expires: a Reviewer's identity is permanent (spec: Permissions) */
	private function rememberReviewer(Response $response, string $key): void {
		$response->addCookie(self::cookieName($this->getToken()), $key, new \DateTime('+10 years'), 'Lax');
	}

	/** @throws NotFoundException no link with this token */
	private function link(): ReviewLink {
		return $this->resolved ??= $this->links->byToken($this->getToken());
	}

	/** Only a live link is a review surface: review on, not paused, not expired */
	public function isValidToken(): bool {
		try {
			return $this->link()->isLive();
		} catch (NotFoundException) {
			return false;
		}
	}

	protected function getPasswordHash(): ?string {
		return $this->link()->passwordHash();
	}

	protected function isPasswordProtected(): bool {
		return $this->link()->passwordHash() !== null;
	}
}
