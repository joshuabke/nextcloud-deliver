<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\NotFoundException;
use OCP\Security\ISecureRandom;

/**
 * Reviewers of a Project. A Reviewer's secret key is their identity: the
 * Personal Link carries it, so they stay the same author on any device.
 */
class ReviewerService {
	private const KEY_LENGTH = 32;
	/** The languages Deliver ships, which a Reviewer can pick */
	public const LANGUAGES = ['de', 'en'];

	public function __construct(
		private ReviewerMapper $reviewers,
		private ITimeFactory $time,
		private ISecureRandom $random,
	) {
	}

	/**
	 * A new Reviewer of the link's Project, named by themselves on the link or
	 * invited through it (ADR 0013). They remember who invited them, which
	 * counts for nothing on a Project (ADR 0017).
	 *
	 * @param ?string $invitedBy the Member who invited them; the link's maker if they named themselves
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail what they want mailed
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function claim(ReviewLink $link, string $name, ?string $email, array $mail = [], ?string $language = null, ?string $invitedBy = null): Reviewer {
		$email = self::email($email);
		$reviewer = new Reviewer();
		$reviewer->setOwnerUid($link->projectId() === null ? $link->ownerUid() : $invitedBy ?? $link->ownerUid());
		$reviewer->setProjectId($link->projectId());
		$reviewer->setName(self::name($name));
		$reviewer->setEmail($email);
		$reviewer->setCreatedAt($this->time->getTime());
		$reviewer->setLanguage(in_array($language, self::LANGUAGES, true) ? $language : null);
		self::wish($reviewer, $mail);
		return $this->reviewers->insert($reviewer);
	}

	/**
	 * A Reviewer changes their name, address or what they want mailed.
	 *
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail
	 * @param ?string $name null keeps it
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function updateSettings(Reviewer $reviewer, ?string $email, array $mail, ?string $name = null, ?string $language = null): Reviewer {
		if ($name !== null) {
			$reviewer->setName(self::name($name));
		}
		if (in_array($language, self::LANGUAGES, true)) {
			$reviewer->setLanguage($language);
		}
		$email = self::email($email);
		$reviewer->setEmail($email);
		self::wish($reviewer, $mail);
		return $this->reviewers->update($reviewer);
	}

	/**
	 * A Member edits a Reviewer: name, address and what they want mailed
	 *
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function update(Reviewer $reviewer, string $name, ?string $email, array $mail): Reviewer {
		$reviewer->setName(self::name($name));
		return $this->updateSettings($reviewer, $email, $mail);
	}

	/** New keys on every link they are on: the old Personal Links stop working, the Reviewer keeps their Comments */
	public function renewKeys(Reviewer $reviewer): Reviewer {
		foreach (array_keys($this->reviewers->placesOfReviewer($reviewer->getId())) as $token) {
			$this->reviewers->setKeyOn($reviewer->getId(), (string)$token, $this->newKey());
		}
		return $reviewer;
	}

	/**
	 * @param ?int $projectId null for No Project
	 * @param string $uid whose No Project, when $projectId is null
	 * @return list<Reviewer> the Project's Reviewers, whoever invited them, on a link or not, oldest first
	 */
	public function ofProject(?int $projectId, string $uid): array {
		return $this->reviewers->findInProject($projectId, [$uid]);
	}

	/** No Personal Link names them any more and they leave every list; their Comments keep their name */
	public function remove(Reviewer $reviewer): void {
		$reviewer->setRemovedAt($this->time->getTime());
		$this->reviewers->update($reviewer);
		$this->reviewers->deleteLinks([$reviewer->getId()]);
	}

	/**
	 * Puts the Reviewer on a link, invited through it or named there (ADR 0014)
	 *
	 * @param ?string $key the key of their Personal Link through it, a new one if not given
	 * @return string the key of their Personal Link through it, the one they have if they are on it already
	 */
	public function putOn(Reviewer $reviewer, string $token, ?string $key = null): string {
		return $this->reviewers->putOn($reviewer->getId(), $token, $key ?? $this->newKey(), $this->time->getTime());
	}

	/** A new key for the Reviewer's Personal Link through this link: the old one stops working */
	public function setKeyOn(Reviewer $reviewer, string $token, string $key): void {
		$this->reviewers->setKeyOn($reviewer->getId(), $token, $key);
	}

	/** How many links the Reviewer is on */
	public function linkCount(Reviewer $reviewer): int {
		return count($this->reviewers->placesOfReviewer($reviewer->getId()));
	}

	/** Takes the Reviewer off one link; their Personal Link through it stops working */
	public function takeOff(Reviewer $reviewer, string $token): void {
		$this->reviewers->takeOff($reviewer->getId(), $token);
	}

	/** A key for a Personal Link: whoever has it is that Reviewer on that link */
	public function newKey(): string {
		return $this->random->generate(self::KEY_LENGTH, ISecureRandom::CHAR_ALPHANUMERIC);
	}

	/** The key of the Reviewer's Personal Link through this link, null when they are not on it */
	public function keyOn(Reviewer $reviewer, string $token): ?string {
		return $this->reviewers->keyOn($reviewer->getId(), $token);
	}

	/** @throws InvalidRequestException the name is empty */
	private static function name(string $name): string {
		$name = trim($name);
		if ($name === '') {
			throw new InvalidRequestException('A Reviewer needs a name');
		}
		return mb_substr($name, 0, 255);
	}

	/** @throws InvalidRequestException not an email address */
	private static function email(?string $email): ?string {
		$email = $email === null || trim($email) === '' ? null : trim($email);
		if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
			throw new InvalidRequestException('That is not an email address');
		}
		return $email;
	}

	/** @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail */
	private static function wish(Reviewer $reviewer, array $mail): void {
		if (isset($mail['replies'])) {
			$reviewer->setMailReplies($mail['replies']);
		}
		if (isset($mail['comments'])) {
			$reviewer->setMailComments($mail['comments']);
		}
		if (isset($mail['versions'])) {
			$reviewer->setMailVersions($mail['versions']);
		}
	}

	/** @throws NotFoundException no such Reviewer */
	public function find(int $id): Reviewer {
		return $this->reviewers->find($id) ?? throw new NotFoundException('Reviewer not found');
	}

	/** The Reviewer whose Personal Link through this link carries this key (ADR 0014) */
	public function byKey(?string $key, ReviewLink $link): ?Reviewer {
		if ($key === null || $key === '') {
			return null;
		}
		$reviewer = $this->reviewers->findOnLink($link->token(), $key);
		return $reviewer !== null && $link->takes($reviewer) ? $reviewer : null;
	}

	public function serialize(Reviewer $reviewer): array {
		return [
			'id' => $reviewer->getId(),
			'name' => $reviewer->getName(),
			'email' => $reviewer->getEmail(),
			'mail' => $reviewer->mailWishes(),
		];
	}
}
