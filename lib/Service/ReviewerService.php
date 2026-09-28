<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Project;
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

	public function __construct(
		private ReviewerMapper $reviewers,
		private ITimeFactory $time,
		private ISecureRandom $random,
	) {
	}

	/**
	 * A new Reviewer, named by themselves on a Share Link or invited by a Member.
	 *
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail what they want mailed
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function claim(Project $project, string $name, ?string $email, array $mail = []): Reviewer {
		$email = self::email($email);
		$reviewer = new Reviewer();
		$reviewer->setProjectId($project->getId());
		$reviewer->setName(self::name($name));
		$reviewer->setEmail($email);
		$reviewer->setSecretKey($this->random->generate(self::KEY_LENGTH, ISecureRandom::CHAR_ALPHANUMERIC));
		$reviewer->setCreatedAt($this->time->getTime());
		self::wish($reviewer, $mail);
		return $this->reviewers->insert($reviewer);
	}

	/**
	 * A Reviewer changes their address or what they want mailed.
	 *
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail
	 * @throws InvalidRequestException the email is not one
	 */
	public function updateSettings(Reviewer $reviewer, ?string $email, array $mail): Reviewer {
		$reviewer->setEmail(self::email($email));
		self::wish($reviewer, $mail);
		return $this->reviewers->update($reviewer);
	}

	/**
	 * A Member edits a Reviewer: name, address and what they want mailed.
	 *
	 * @param array{replies?: ?bool, comments?: ?bool, versions?: ?bool} $mail
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function update(Reviewer $reviewer, string $name, ?string $email, array $mail): Reviewer {
		$reviewer->setName(self::name($name));
		return $this->updateSettings($reviewer, $email, $mail);
	}

	/** A new key: the old Personal Links stop working, the Reviewer keeps their Comments */
	public function renewKey(Reviewer $reviewer): Reviewer {
		$reviewer->setSecretKey($this->random->generate(self::KEY_LENGTH, ISecureRandom::CHAR_ALPHANUMERIC));
		return $this->reviewers->update($reviewer);
	}

	/** Remembers the Share Link the Reviewer was invited through or came in by */
	public function cameBy(Reviewer $reviewer, int $shareId): void {
		$this->reviewers->recordLink($reviewer->getId(), $shareId, $this->time->getTime());
	}

	/**
	 * @param list<Reviewer> $reviewers
	 * @return array<int, list<int>> Share Link id → the Reviewers who were invited through it or came in by it
	 */
	public function byLink(array $reviewers): array {
		return $this->reviewers->reviewersByLink(array_map(static fn (Reviewer $reviewer) => $reviewer->getId(), $reviewers));
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

	/** The Reviewer with this key, if they belong to this Project */
	public function byKey(?string $key, Project $project): ?Reviewer {
		if ($key === null || $key === '') {
			return null;
		}
		$reviewer = $this->reviewers->findByKey($key);
		return $reviewer?->getProjectId() === $project->getId() ? $reviewer : null;
	}

	/** @return Reviewer[] */
	public function forProject(Project $project): array {
		return $this->reviewers->findByProject($project->getId());
	}

	public function serialize(Reviewer $reviewer): array {
		return [
			'id' => $reviewer->getId(),
			'name' => $reviewer->getName(),
			'email' => $reviewer->getEmail(),
			'key' => $reviewer->getSecretKey(),
			'mail' => $reviewer->mailWishes(),
		];
	}
}
