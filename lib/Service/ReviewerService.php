<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCP\AppFramework\Utility\ITimeFactory;
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
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function claim(Project $project, string $name, ?string $email): Reviewer {
		$name = trim($name);
		if ($name === '') {
			throw new InvalidRequestException('A Reviewer needs a name');
		}
		$email = $email === null || trim($email) === '' ? null : trim($email);
		if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
			throw new InvalidRequestException('That is not an email address');
		}
		$reviewer = new Reviewer();
		$reviewer->setProjectId($project->getId());
		$reviewer->setName(mb_substr($name, 0, 255));
		$reviewer->setEmail($email);
		$reviewer->setSecretKey($this->random->generate(self::KEY_LENGTH, ISecureRandom::CHAR_ALPHANUMERIC));
		$reviewer->setCreatedAt($this->time->getTime());
		return $this->reviewers->insert($reviewer);
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
		];
	}
}
