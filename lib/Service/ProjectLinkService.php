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

/** A Member's Project Links (ADR 0010, 0011): made, changed and removed by the Member who made them */
class ProjectLinkService {
	private const TOKEN_LENGTH = 20;

	public function __construct(
		private ProjectLinkMapper $links,
		private LinkActivityMapper $activity,
		private ProjectService $projects,
		private AssetMapper $assets,
		private ReviewLinks $reviewLinks,
		private ISecureRandom $random,
		private IHasher $hasher,
		private IEventDispatcher $events,
		private ITimeFactory $time,
		private IConfig $config,
	) {
	}

	/**
	 * A new link on a Project the Member sees, live and showing all of it or
	 * the Assets given (story 120); on No Project, the Assets given of it.
	 *
	 * @param ?list<int> $assetIds
	 * @throws NotFoundException the Project is not in reach
	 * @throws InvalidRequestException a link on No Project without Assets
	 */
	public function create(string $uid, int $projectId, ?array $assetIds = null): array {
		$link = new ProjectLink();
		if ($projectId === ProjectService::NONE) {
			$link->setProjectId(null);
		} else {
			$this->projects->visible($uid, $projectId);
			$link->setProjectId($projectId);
		}
		$link->setAssetIds($this->picked($link, $assetIds));
		if ($link->getProjectId() === null && $link->getAssetIds() === null) {
			throw new InvalidRequestException('A link on No Project shows the Assets picked for it');
		}
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
	 * an empty $assetIds or null means the whole Project again (not on No Project).
	 *
	 * @param array<string, mixed> $fields review, canComment, allowOlder, watermark, canDownload, latestOnly, label, description, password, expireDate, assetIds
	 * @throws InvalidRequestException a password the policy refuses, an expiry in the past or no date
	 */
	public function update(string $uid, int $id, array $fields): array {
		$link = $this->own($uid, $id);
		foreach (ReviewLink::FLAGS as $flag) {
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
			$picked = $this->picked($link, $fields['assetIds']);
			if ($picked === null && $link->getProjectId() === null) {
				throw new InvalidRequestException('A link on No Project shows the Assets picked for it');
			}
			$link->setAssetIds($picked);
		}
		return $this->serialize($this->links->update($link));
	}

	/** Deletes the link; its Reviewers stay the Member's, their Comments stay */
	public function delete(string $uid, int $id): void {
		$link = $this->own($uid, $id);
		$this->activity->deleteByToken($link->getToken());
		$this->links->delete($link);
	}

	/** @return list<array<string, mixed>> the Member's links on a Project, or on No Project for 0, for its navigation */
	public function listFor(string $uid, int $projectId): array {
		$links = $this->links->findByProject($projectId === ProjectService::NONE ? null : $projectId, $uid);
		return array_map(fn (ProjectLink $link) => $this->serialize($link), $links);
	}

	/**
	 * A link the user made, as a ReviewLink, for Reviewers and activity
	 *
	 * @throws NotFoundException|AccessDeniedException
	 */
	public function ownLink(string $uid, int $id): ReviewLink {
		return $this->reviewLinks->of($this->own($uid, $id));
	}

	public function serialize(ProjectLink $link): array {
		$reviewLink = $this->reviewLinks->of($link);
		return [
			'id' => $link->getId(),
			'kind' => 'project',
			'token' => $link->getToken(),
			'url' => $reviewLink->url(),
			'projectId' => $link->getProjectId() ?? ProjectService::NONE,
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

	private function newToken(): string {
		do {
			$token = $this->random->generate(self::TOKEN_LENGTH, ISecureRandom::CHAR_HUMAN_READABLE);
		} while ($this->links->findByToken($token) !== null);
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

	/** The picked Assets of the link's Project, or of No Project, as JSON; null for all of it */
	private function picked(ProjectLink $link, mixed $assetIds): ?string {
		if (!is_array($assetIds) || $assetIds === []) {
			return null;
		}
		$projectId = $link->getProjectId();
		$ofProject = array_map(
			static fn ($asset) => $asset->getId(),
			array_filter($this->assets->findByIds(array_map('intval', $assetIds)), static fn ($asset) => $asset->getProjectId() === $projectId),
		);
		return $ofProject === [] && $projectId === null ? null : json_encode(array_values($ofProject), JSON_THROW_ON_ERROR);
	}
}
