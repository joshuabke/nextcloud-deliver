<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\ProjectLink;
use OCA\Deliver\Db\ProjectLinkMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Files\NotFoundException;
use OCP\HintException;
use OCP\IConfig;
use OCP\Security\Events\ValidatePasswordPolicyEvent;
use OCP\Security\IHasher;
use OCP\Security\ISecureRandom;
use OCP\Share\Exceptions\ShareNotFound;
use OCP\Share\IManager as IShareManager;

/** A Member's Project Links (ADR 0010): made, changed and removed by the Member who made them */
class ProjectLinkService {
	private const TOKEN_LENGTH = 20;

	public function __construct(
		private ProjectLinkMapper $links,
		private LinkActivityMapper $activity,
		private ProjectService $projects,
		private AssetMapper $assets,
		private ReviewLinks $reviewLinks,
		private IShareManager $shares,
		private ISecureRandom $random,
		private IHasher $hasher,
		private IEventDispatcher $events,
		private ITimeFactory $time,
		private IConfig $config,
	) {
	}

	/**
	 * A new link on a Project the Member sees, live and showing all of it (story 120)
	 *
	 * @throws NotFoundException the Project is not in reach
	 */
	public function create(string $uid, int $projectId): array {
		$this->projects->visible($uid, $projectId);
		$link = new ProjectLink();
		$link->setProjectId($projectId);
		$link->setOwnerUid($uid);
		$link->setToken($this->newToken());
		$link->setReview(true);
		$link->setCanComment(true);
		$link->setAllowOlder(false);
		$link->setWatermark(false);
		$link->setCanDownload(true);
		$link->setLatestOnly(false);
		$link->setCreatedAt($this->time->getTime());
		return $this->serialize($this->links->insert($link));
	}

	/**
	 * Changes what is given; '' removes password, expiry and description, and
	 * an empty $assetIds of null means the whole Project again.
	 *
	 * @param array<string, mixed> $fields review, canComment, allowOlder, watermark, canDownload, latestOnly, label, description, password, expireDate, assetIds
	 * @throws InvalidRequestException a password the policy refuses, an expiry in the past or no date
	 */
	public function update(string $uid, int $id, array $fields): array {
		$link = $this->own($uid, $id);
		foreach (['review', 'canComment', 'allowOlder', 'watermark', 'canDownload', 'latestOnly'] as $flag) {
			if (isset($fields[$flag])) {
				$link->{'set' . ucfirst($flag)}((bool)$fields[$flag]);
			}
		}
		foreach (['label', 'description'] as $text) {
			if (isset($fields[$text])) {
				$value = trim((string)$fields[$text]);
				$link->{'set' . ucfirst($text)}($value === '' ? null : $value);
			}
		}
		if (isset($fields['password'])) {
			$link->setPasswordHash($this->hashed((string)$fields['password']));
		}
		if (isset($fields['expireDate'])) {
			$link->setExpireDate($this->expiry((string)$fields['expireDate']));
		}
		if (array_key_exists('assetIds', $fields)) {
			$link->setAssetIds($this->picked($link, $fields['assetIds']));
		}
		return $this->serialize($this->links->update($link));
	}

	/** Deletes the link; its Reviewers stay the Member's, their Comments stay */
	public function delete(string $uid, int $id): void {
		$link = $this->own($uid, $id);
		$this->activity->deleteByToken($link->getToken());
		$this->links->delete($link);
	}

	/** @return list<array<string, mixed>> the Member's links on a Project, for its navigation */
	public function listFor(string $uid, int $projectId): array {
		return array_map(fn (ProjectLink $link) => $this->serialize($link), $this->links->findByProject($projectId, $uid));
	}

	/**
	 * A link the user made, as a ReviewLink, for Reviewers and activity
	 *
	 * @throws NotFoundException|AccessDeniedException
	 */
	public function ownLink(string $uid, int $id): ProjectReviewLink {
		return $this->reviewLinks->ofProjectLink($this->own($uid, $id));
	}

	public function serialize(ProjectLink $link): array {
		$reviewLink = $this->reviewLinks->ofProjectLink($link);
		return [
			'id' => $link->getId(),
			'kind' => 'project',
			'token' => $link->getToken(),
			'url' => $reviewLink->url(),
			'projectId' => $link->getProjectId(),
			'label' => $link->getLabel(),
			'description' => $link->getDescription(),
			'hasPassword' => $link->getPasswordHash() !== null,
			'expireDate' => $link->getExpireDate(),
			'assetIds' => $link->pickedAssets(),
			// Whether Reviewers can be mailed about Replies at all (story 66)
			'canMail' => ReviewerMail::configured($this->config),
		] + $reviewLink->flags();
	}

	/**
	 * @throws NotFoundException no such link
	 * @throws AccessDeniedException another Member's link
	 */
	private function own(string $uid, int $id): ProjectLink {
		$link = $this->links->find($id) ?? throw new NotFoundException('Link not found');
		if ($link->getOwnerUid() !== $uid) {
			throw new AccessDeniedException('Only the Member who made a link changes it');
		}
		return $link;
	}

	/** A token no link of either kind has, longer than Nextcloud's own */
	private function newToken(): string {
		do {
			$token = $this->random->generate(self::TOKEN_LENGTH, ISecureRandom::CHAR_HUMAN_READABLE);
			try {
				$this->shares->getShareByToken($token);
				$taken = true;
			} catch (ShareNotFound) {
				$taken = $this->links->findByToken($token) !== null;
			}
		} while ($taken);
		return $token;
	}

	/** @throws InvalidRequestException Nextcloud's password policy refuses it */
	private function hashed(string $password): ?string {
		if ($password === '') {
			return null;
		}
		try {
			$this->events->dispatchTyped(new ValidatePasswordPolicyEvent($password));
		} catch (HintException $e) {
			throw new InvalidRequestException($e->getHint());
		}
		return $this->hasher->hash($password);
	}

	/** @throws InvalidRequestException no date, or one in the past */
	private function expiry(string $date): ?string {
		if ($date === '') {
			return null;
		}
		$parsed = \DateTime::createFromFormat('!Y-m-d', $date);
		if ($parsed === false || $parsed->format('Y-m-d') !== $date) {
			throw new InvalidRequestException('The expiry is a date such as 2026-12-31');
		}
		if ($date < $this->time->getDateTime()->format('Y-m-d')) {
			throw new InvalidRequestException('The expiry date is in the past');
		}
		return $date;
	}

	/** The picked Assets of the link's Project as JSON, or null for all of it */
	private function picked(ProjectLink $link, mixed $assetIds): ?string {
		if (!is_array($assetIds)) {
			return null;
		}
		$ofProject = array_map(static fn ($asset) => $asset->getId(), $this->assets->findByProject($link->getProjectId()));
		return json_encode(array_values(array_intersect(array_map('intval', $assetIds), $ofProject)), JSON_THROW_ON_ERROR);
	}
}
