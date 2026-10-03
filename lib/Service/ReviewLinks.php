<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\ProjectLink;
use OCA\Deliver\Db\ProjectLinkMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IURLGenerator;
use OCP\Security\IHasher;

/**
 * Finds the link behind a token, a Project Link (ADR 0010) or a Share Link
 * (ADR 0004), and does what is alike for both: Versions behind it,
 * Reviewers who came by it, and its activity.
 */
class ReviewLinks {
	public function __construct(
		private ShareReviewService $sharing,
		private ProjectLinkMapper $projectLinks,
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private ReviewerService $reviewers,
		private ReviewerMapper $reviewerMapper,
		private LinkActivityMapper $activity,
		private IRootFolder $root,
		private IHasher $hasher,
		private IURLGenerator $urls,
		private ITimeFactory $time,
	) {
	}

	/** @throws NotFoundException no link with this token */
	public function byToken(string $token): ReviewLink {
		$link = $this->projectLinks->findByToken($token);
		return $link === null ? $this->sharing->wrap($this->sharing->byToken($token)) : $this->ofProjectLink($link);
	}

	public function ofProjectLink(ProjectLink $link): ProjectReviewLink {
		return new ProjectReviewLink($link, $this->projects, $this->assets, $this->versions, $this->root, $this->hasher, $this->urls, $this->time);
	}

	/** @throws NotFoundException the Version is outside what the link shows */
	public function version(ReviewLink $link, int $versionId): Version {
		return $link->version($this->versions->find($versionId) ?? throw new NotFoundException('Version not found'));
	}

	/**
	 * The Version of a file behind the link, for the Review button in a shared file list.
	 *
	 * @throws NotFoundException the file is not enabled for review here
	 */
	public function versionForFile(ReviewLink $link, int $fileId): Version {
		return $link->version($this->versions->findByFile($fileId) ?? throw new NotFoundException('This file is not enabled for review'));
	}

	/** Remembers what happened on a link (story 124) */
	public function record(ReviewLink $link, string $kind, ?Reviewer $reviewer, ?Version $version = null): void {
		$this->activity->record($link->token(), $kind, $reviewer?->getId(), $version?->getId(), $this->time->getTime());
	}

	/**
	 * What happened on a link, newest first, with who and which Version.
	 *
	 * @return list<array<string, mixed>>
	 */
	public function activityOf(ReviewLink $link): array {
		$rows = $this->activity->latest($link->token());
		$reviewers = [];
		$versions = [];
		foreach ($rows as $row) {
			if ($row['reviewerId'] !== null) {
				$reviewers[$row['reviewerId']] ??= $this->reviewerMapper->find($row['reviewerId']);
			}
			if ($row['versionId'] !== null) {
				$versions[$row['versionId']] ??= $this->versions->find($row['versionId']);
			}
		}
		return array_map(static function (array $row) use ($reviewers, $versions) {
			$reviewer = $row['reviewerId'] === null ? null : $reviewers[$row['reviewerId']];
			$version = $row['versionId'] === null ? null : $versions[$row['versionId']];
			return [
				'kind' => $row['kind'],
				'at' => $row['at'],
				'reviewer' => $reviewer === null ? null : ['id' => $reviewer->getId(), 'name' => $reviewer->getName()],
				'versionId' => $row['versionId'],
				'version' => $version === null ? null : ['name' => $version->getName(), 'number' => $version->getNumber()],
			];
		}, $rows);
	}

	/**
	 * The Reviewers of the Member who made the link, each with a Personal Link
	 * through it, so a replaced link can be handed out again (story 55).
	 *
	 * @return list<array<string, mixed>>
	 */
	public function reviewersOf(ReviewLink $link): array {
		return array_map(
			fn (Reviewer $reviewer) => $this->reviewers->serialize($reviewer) + ['link' => $link->personalLink($reviewer)],
			$this->reviewerMapper->findByOwners([$link->ownerUid()]),
		);
	}

	/**
	 * A new Reviewer, invited by a Member, with their Personal Link (story 53).
	 *
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function invite(ReviewLink $link, string $name, ?string $email): array {
		$reviewer = $this->reviewers->claim($link->ownerUid(), $name, $email);
		$this->reviewers->cameBy($reviewer, $link->token());
		return $this->reviewers->serialize($reviewer) + ['link' => $link->personalLink($reviewer)];
	}

	/**
	 * The user's Reviewers who came by one of these links, paused or not, each
	 * with their Personal Link through every live one, and who came by which link.
	 *
	 * @param list<string> $tokens every link listed
	 * @param array<string, string> $urls token → URL of each live link
	 * @return array{reviewers: list<array<string, mixed>>, cameBy: array<string, list<int>>}
	 */
	public function reviewersBy(string $uid, array $tokens, array $urls): array {
		$reviewers = $this->reviewerMapper->findByOwners([$uid]);
		$cameBy = $this->reviewerMapper->reviewersByLink(array_map(static fn (Reviewer $reviewer) => $reviewer->getId(), $reviewers));
		$cameBy = array_intersect_key($cameBy, array_flip($tokens));
		$shown = array_merge([], ...array_values($cameBy));
		$reviewers = array_values(array_filter($reviewers, static fn (Reviewer $reviewer) => in_array($reviewer->getId(), $shown, true)));
		return [
			'reviewers' => array_map(fn (Reviewer $reviewer) => $this->reviewers->serialize($reviewer) + [
				'links' => array_map(
					static fn (string $token, string $url) => ['token' => $token, 'url' => $url . '?r=' . rawurlencode((string)$reviewer->getSecretKey())],
					array_keys($urls),
					array_values($urls),
				),
			], $reviewers),
			'cameBy' => $cameBy,
		];
	}

	/**
	 * The Review view of the Version through a link of the Reviewer's Member
	 * that shows it, with the Reviewer's key, for mails; a Project Link of the
	 * Version's Project first, else the nearest review Share Link; null when
	 * none does any more. It opens the player straight away.
	 */
	public function reviewLinkFor(Version $version, Reviewer $reviewer): ?string {
		$owner = $reviewer->getOwnerUid();
		$token = null;
		$projectId = $version->getProjectId();
		foreach ($projectId === null ? [] : $this->projectLinks->findByProject($projectId, $owner) as $each) {
			$link = $this->ofProjectLink($each);
			try {
				if ($link->isLive() && $link->version($version) === $version) {
					$token = $link->token();
					break;
				}
			} catch (NotFoundException) {
			}
		}
		$token ??= $this->sharing->reviewShareFor($owner, $version->getFileId())?->getToken();
		return $token === null ? null
			: $this->sharing->instanceUrl($this->urls->linkToRoute('deliver.Public.showVersion', ['token' => $token, 'versionId' => $version->getId()]))
				. '?r=' . rawurlencode((string)$reviewer->getSecretKey());
	}
}
