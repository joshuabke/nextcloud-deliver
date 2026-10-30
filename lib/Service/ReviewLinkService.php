<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\ReviewLinkMapper;
use OCA\Deliver\Db\ReviewLinkRecord;
use OCA\Deliver\Db\Scope;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Files\NotFoundException;
use OCP\HintException;
use OCP\IUserManager;
use OCP\Security\Events\ValidatePasswordPolicyEvent;
use OCP\Security\IHasher;
use OCP\Security\ISecureRandom;

/**
 * A Project's Review Links (ADR 0010, 0011): made, changed and removed by every Member with Share (ADR 0016, 0017), on No Project by the Member
 * alone; what goes on behind a token is ReviewLinks'
 */
class ReviewLinkService {
	private const TOKEN_LENGTH = 20;

	public function __construct(
		private ReviewLinkMapper $linkRecords,
		private ProjectService $projects,
		private AssetMapper $assets,
		private StackService $stacks,
		private ReviewLinks $reviewLinks,
		private ISecureRandom $random,
		private IUserManager $users,
		private IHasher $hasher,
		private IEventDispatcher $events,
		private ITimeFactory $time,
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
		$link = new ReviewLinkRecord();
		$projectId = $projectId === ProjectService::NONE ? null : $projectId;
		$this->mayShare($uid, Scope::of($projectId, $uid));
		$link->setProjectId($projectId);
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
		return $this->serialize($this->linkRecords->insert($link));
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
		return $this->serialize($this->linkRecords->update($link));
	}

	/** Deletes the link; its Reviewers stay the Project's, their Comments stay */
	public function delete(string $uid, int $id): void {
		$link = $this->own($uid, $id);
		$this->linkRecords->forget($link);
	}

	/**
	 * @return list<array<string, mixed>> the Project's links, or the Member's on No Project for 0, for its navigation
	 * @throws NotFoundException a Deleted Project, or one the Member does not see
	 */
	public function listFor(string $uid, int $projectId): array {
		$scope = Scope::of($projectId === ProjectService::NONE ? null : $projectId, $uid);
		// A Deleted Project's links wait for its restore, as if it were gone (ADR 0015)
		$this->mayShare($uid, $scope);
		$links = $this->linkRecords->findByProject($scope);
		return array_map(fn (ReviewLinkRecord $link) => $this->serialize($link), $links);
	}

	/**
	 * A link the user made, as a ReviewLink, for Reviewers and activity
	 *
	 * @throws NotFoundException|AccessDeniedException
	 */
	public function ownLink(string $uid, int $id): ReviewLink {
		return $this->reviewLinks->of($this->own($uid, $id));
	}

	public function serialize(ReviewLinkRecord $link): array {
		$reviewLink = $this->reviewLinks->of($link);
		$picked = $link->pickedAssets();
		// Named only as the link shows it: an Asset the Member may not share stays out of it, name and all (ADR 0009)
		$only = $picked !== null && count($picked) === 1 ? ($reviewLink->assets()[$picked[0]]['asset'] ?? null) : null;
		return [
			'id' => $link->getId(),
			'kind' => 'project',
			'token' => $link->getToken(),
			'url' => $reviewLink->url(),
			'projectId' => $link->getProjectId() ?? ProjectService::NONE,
			// Who made it, whose reshare rights bound what it shows (ADR 0010, 0017)
			'madeBy' => ['id' => $link->getOwnerUid(), 'name' => $this->users->getDisplayName($link->getOwnerUid()) ?? $link->getOwnerUid()],
			'label' => $link->getLabel(),
			'description' => $link->getDescription(),
			'hasPassword' => $link->getPasswordHash() !== null,
			'expireDate' => $link->getExpireDate(),
			// Opens for Reviewers: not paused and not expired
			'live' => $reviewLink->isLive(),
			'assetIds' => $picked,
			// Its one Asset's name, which titles it (story 145)
			'assetName' => $only === null ? null : $this->stacks->nameOf($only),
		] + $reviewLink->flags();
	}

	/**
	 * @throws NotFoundException no such link, or one of a Deleted Project, which waits for its restore (ADR 0015), or of a Project the Member does not see
	 * @throws AccessDeniedException another Member's link on No Project
	 */
	private function own(string $uid, int $id): ReviewLinkRecord {
		$link = $this->linkRecords->find($id);
		if ($link === null) {
			throw new NotFoundException('Link not found');
		}
		$this->mayShare($uid, Scope::of($link->getProjectId(), $link->getOwnerUid()));
		return $link;
	}

	/**
	 * Who manages the links and Reviewers of a Project, in one place: every
	 * Member with Share (ADR 0016, 0017). On No Project they are the Member's own.
	 *
	 * @param Scope $scope what they belong to; on No Project they are the Member's who made the link or invited the Reviewer
	 * @throws NotFoundException no such Project, a Deleted Project (ADR 0015) or one the Member does not see
	 * @throws AccessDeniedException another Member's, on No Project; a Project where they have no Share
	 */
	public function mayShare(string $uid, Scope $scope): void {
		if ($scope->isNoProject()) {
			if ($scope->ownerUids !== [$uid]) {
				throw new AccessDeniedException('Only the Member they belong to changes links and Reviewers on No Project');
			}
			return;
		}
		$this->projects->assertShare($uid, (int)$scope->projectId);
	}

	private function newToken(): string {
		do {
			$token = $this->random->generate(self::TOKEN_LENGTH, ISecureRandom::CHAR_HUMAN_READABLE);
		} while ($this->linkRecords->findByToken($token) !== null);
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
	private function picked(ReviewLinkRecord $link, mixed $assetIds): ?string {
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
