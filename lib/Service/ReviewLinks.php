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
use OCP\IConfig;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\Security\IHasher;

/**
 * Finds the Review Link behind a token (ADR 0011) and what goes with it:
 * Versions behind it, Reviewers who came by it, and its activity.
 */
class ReviewLinks {
	public function __construct(
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
		private IConfig $config,
		private Members $members,
		private IUserManager $users,
		private IL10N $l,
		private Contacts $contacts,
	) {
	}

	/** @throws NotFoundException no link with this token */
	public function byToken(string $token): ReviewLink {
		return $this->of($this->projectLinks->findByToken($token) ?? throw new NotFoundException('Link not found'));
	}

	public function of(ProjectLink $link): ReviewLink {
		return new ReviewLink($link, $this->projects, $this->assets, $this->versions, $this->root, $this->hasher, $this->urls, $this->time);
	}

	/** @throws NotFoundException the Version is outside what the link shows */
	public function version(ReviewLink $link, int $versionId): Version {
		return $link->version($this->versions->find($versionId) ?? throw new NotFoundException('Version not found'));
	}

	/**
	 * The Version of a file behind the link, for its still and a link straight to it.
	 *
	 * @throws NotFoundException the file is not enabled for review here
	 */
	public function versionForFile(ReviewLink $link, int $fileId): Version {
		return $link->version($this->versions->findByFile($fileId) ?? throw new NotFoundException('This file is not enabled for review'));
	}

	/**
	 * Whether a logged-in user is a Member of each of these Versions: they can
	 * open its file in Files, as rights follow each file (ADR 0009). They
	 * preview it as Reviewers see it but review it in the app (story 59).
	 */
	public function isMember(?string $uid, Version ...$versions): bool {
		if ($uid === null || $versions === []) {
			return false;
		}
		$home = $this->root->getUserFolder($uid);
		foreach ($versions as $version) {
			if ($home->getFirstNodeById($version->getFileId()) === null) {
				return false;
			}
		}
		return true;
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
	 * The Reviewers who come by the link, each with a Personal Link through
	 * it, so a replaced link can be handed out again (story 55).
	 *
	 * @return list<array<string, mixed>>
	 */
	public function reviewersOf(ReviewLink $link): array {
		$rights = $this->reviewerMapper->rightsByLink(array_map(
			static fn (Reviewer $reviewer) => $reviewer->getId(),
			array_filter($this->reviewerMapper->findByOwners([$link->ownerUid()]), $link->takes(...)),
		));
		// Those on this link, whose Personal Link opens it (ADR 0014)
		$reviewers = array_values(array_filter(
			$this->reviewerMapper->findByOwners([$link->ownerUid()]),
			static fn (Reviewer $reviewer) => isset($rights[$reviewer->getId()][$link->token()]),
		));
		return array_map(
			fn (Reviewer $reviewer) => $this->reviewers->serialize($reviewer) + [
				'link' => $link->personalLink($reviewer),
				// Their own rights here (ADR 0014)
				'rights' => $rights[$reviewer->getId()][$link->token()],
			],
			$reviewers,
		);
	}

	/**
	 * A Reviewer invited by a Member, for their Personal Link (story 53): one
	 * whose address the Project already knows gets this link too, under the
	 * name they have, so that every address is one Reviewer (ADR 0014).
	 *
	 * @throws InvalidRequestException the name is empty or the email is not one
	 * @throws ProjectConflictException someone in the review has the name
	 */
	public function invite(ReviewLink $link, string $name, ?string $email): Reviewer {
		$reviewer = $this->returning($link, $email);
		if ($reviewer === null) {
			$this->assertNameFree($link, $name);
			$reviewer = $this->reviewers->claim($link, $name, $email);
		}
		$this->reviewers->cameBy($reviewer, $link->token());
		return $reviewer;
	}

	/**
	 * Refuses a Reviewer's new name that someone already has in a review the
	 * Reviewer came by; the name they have stays theirs. Renaming themselves,
	 * a Reviewer only keeps clear of the Members' names, as on naming oneself.
	 *
	 * @throws ProjectConflictException
	 */
	public function assertRenameFree(Reviewer $reviewer, string $name, bool $reviewersToo = true): void {
		if (self::normal($name) === self::normal((string)$reviewer->getName())) {
			return;
		}
		$reviews = [];
		foreach (array_keys($this->reviewerMapper->reviewersByLink([$reviewer->getId()])) as $token) {
			try {
				$link = $this->byToken($token);
			} catch (NotFoundException) {
				continue;
			}
			// One check per Project: its links share one review
			$reviews[$link->projectId() ?? $token] ??= $link;
		}
		foreach ($reviews as $link) {
			$this->assertNameFree($link, $name, $reviewer, $reviewersToo);
		}
	}

	/**
	 * Refuses a name someone in the review already goes by: a Member of what
	 * the link shows and, unless left out, a Reviewer who came by any Member's
	 * link of its Project (of this link alone, for a file in No Project),
	 * other than the one named (stories 53, 54). Case and surrounding spaces
	 * do not count.
	 * ponytail: checked before the insert, not locked; two claims of one name in the same instant both pass
	 *
	 * @param bool $reviewersToo false where Reviewers may share a name, told apart by their colour (naming oneself, as on Frame.io)
	 * @throws ProjectConflictException
	 */
	public function assertNameFree(ReviewLink $link, string $name, ?Reviewer $except = null, bool $reviewersToo = true): void {
		$fileIds = array_map(static fn (Version $version) => $version->getFileId(), array_merge([], ...array_column($link->assets(), 'versions')));
		$uids = array_unique(array_merge([$link->ownerUid()], ...array_map($this->members->of(...), array_unique($fileIds))));
		$tokens = !$reviewersToo ? [] : ($link->projectId() === null ? [$link->token()]
			: array_map(static fn (ProjectLink $each) => $each->getToken(), $this->projectLinks->findAllOf($link->projectId())));
		$names = [
			...array_map(fn (string $uid) => $this->users->getDisplayName($uid) ?? $uid, $uids),
			...($reviewersToo ? $this->reviewerMapper->namesByLinks($tokens, $except?->getId()) : []),
		];
		if (in_array(self::normal($name), array_map(self::normal(...), $names), true)) {
			throw $this->nameTaken($name);
		}
	}

	/**
	 * The link's Reviewer with this address, whatever their case: naming
	 * oneself with it mails them their Personal Link, as on Frame.io, and an
	 * invitation gives them the link too (ADR 0014).
	 */
	public function returning(ReviewLink $link, ?string $email): ?Reviewer {
		$email = trim((string)$email);
		if ($email === '') {
			return null;
		}
		foreach ($this->reviewerMapper->findByAddress($link->ownerUid(), $email) as $reviewer) {
			if ($link->takes($reviewer)) {
				return $reviewer;
			}
		}
		return null;
	}

	/**
	 * Refuses a new address another Reviewer of the same Project already has
	 * (ADR 0014), whoever changes it; the one they have stays theirs, even
	 * where two Reviewers share it from before.
	 *
	 * @throws ProjectConflictException
	 */
	public function assertAddressFree(Reviewer $reviewer, ?string $email): void {
		$email = trim((string)$email);
		if ($email === '' || mb_strtolower($email) === mb_strtolower((string)$reviewer->getEmail())) {
			return;
		}
		foreach ($this->reviewerMapper->findByAddress($reviewer->getOwnerUid(), $email) as $other) {
			if ($other->getId() !== $reviewer->getId() && $other->getProjectId() === $reviewer->getProjectId()) {
				throw $this->addressTaken($email);
			}
		}
	}

	/**
	 * The link's review flags as they hold for this Reviewer: their own rights
	 * on this link over the link's (ADR 0014)
	 *
	 * @return array<string, mixed>
	 */
	public function flagsFor(ReviewLink $link, ?Reviewer $reviewer): array {
		$flags = $link->flags();
		if ($reviewer !== null) {
			foreach ($this->reviewerMapper->rightsOn($reviewer->getId(), $link->token()) ?? [] as $right => $value) {
				if ($value !== null) {
					$flags[$right] = $value;
				}
			}
		}
		return $flags;
	}

	/**
	 * A Member sets a Reviewer's own rights on one link they came by; null
	 * leaves each to the link
	 *
	 * @param array{canComment?: ?bool, allowOlder?: ?bool, watermark?: ?bool} $rights
	 * @return array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool} the rights as they are now
	 * @throws NotFoundException the Reviewer never came by that link
	 */
	public function setRights(Reviewer $reviewer, string $token, array $rights): array {
		if ($this->reviewerMapper->rightsOn($reviewer->getId(), $token) === null) {
			throw new NotFoundException('The Reviewer never came by that link');
		}
		$this->reviewerMapper->setRightsOn($reviewer->getId(), $token, $rights);
		return $this->reviewerMapper->rightsOn($reviewer->getId(), $token) ?? throw new NotFoundException('The Reviewer never came by that link');
	}

	/** The refusal of an address another Reviewer of the Project has */
	public function addressTaken(string $email): ProjectConflictException {
		return new ProjectConflictException($this->l->t('Someone in this review already has the address %s.', [trim($email)]));
	}

	/** The refusal of a name someone in the review already goes by */
	public function nameTaken(string $name): ProjectConflictException {
		return new ProjectConflictException($this->l->t('Someone in this review is already called "%s".', [trim($name)]));
	}

	/** A name as it is stored (ReviewerService), without case */
	private static function normal(string $name): string {
		return mb_strtolower(mb_substr(trim($name), 0, 255));
	}

	/**
	 * The user's Reviewers of the Project who came by one of these links, paused or not, each
	 * with their Personal Link through every live one, and who came by which link.
	 *
	 * @param ?int $projectId null for No Project
	 * @param list<string> $tokens every link listed
	 * @param array<string, string> $urls token → URL of each live link
	 * @return array{reviewers: list<array<string, mixed>>, cameBy: array<string, list<int>>}
	 */
	public function reviewersBy(string $uid, ?int $projectId, array $tokens, array $urls): array {
		$reviewers = array_filter($this->reviewerMapper->findByOwners([$uid]), static fn (Reviewer $reviewer) => $reviewer->getProjectId() === $projectId);
		$cameBy = $this->reviewerMapper->reviewersByLink(array_map(static fn (Reviewer $reviewer) => $reviewer->getId(), $reviewers));
		$cameBy = array_intersect_key($cameBy, array_flip($tokens));
		$shown = array_merge([], ...array_values($cameBy));
		$reviewers = array_values(array_filter($reviewers, static fn (Reviewer $reviewer) => in_array($reviewer->getId(), $shown, true)));
		$this->contacts->checkContacts($reviewers);
		$rights = $this->reviewerMapper->rightsByLink(array_map(static fn (Reviewer $reviewer) => $reviewer->getId(), $reviewers));
		return [
			'reviewers' => array_map(fn (Reviewer $reviewer) => $this->reviewers->serialize($reviewer) + [
				'inContacts' => $reviewer->getInContacts(),
				'links' => self::personalLinks($reviewer, $urls, $rights[$reviewer->getId()] ?? []),
			], $reviewers),
			'cameBy' => $cameBy,
		];
	}

	/**
	 * A Personal Link through each live link the Reviewer is on, with their own rights there (ADR 0014)
	 *
	 * @param array<string, string> $urls token → URL of the live links
	 * @param array<string, array<string, ?bool>> $rights token → their own rights, for each link they are on
	 * @return list<array{token: string, url: string, rights: array<string, ?bool>}>
	 */
	private static function personalLinks(Reviewer $reviewer, array $urls, array $rights): array {
		$links = [];
		foreach (array_intersect_key($urls, $rights) as $token => $url) {
			$links[] = ['token' => (string)$token, 'url' => $url . '?r=' . rawurlencode((string)$reviewer->getSecretKey()), 'rights' => $rights[$token]];
		}
		return $links;
	}

	/**
	 * The Review view of the Version through a live link the Reviewer comes
	 * by that shows it, with the Reviewer's key, for mails; null when none
	 * does any more, or the Version went to another Project. It opens the
	 * player straight away.
	 */
	public function reviewLinkFor(Version $version, Reviewer $reviewer): ?string {
		$token = null;
		foreach ($this->projectLinks->findByProject($version->getProjectId(), $reviewer->getOwnerUid()) as $each) {
			$link = $this->of($each);
			try {
				if ($link->isLive() && $link->takes($reviewer) && $this->reviewerMapper->isOn($reviewer->getId(), $link->token()) && $link->version($version) === $version) {
					$token = $link->token();
					break;
				}
			} catch (NotFoundException) {
			}
		}
		return $token === null ? null
			: $this->instanceUrl($this->urls->linkToRoute('deliver.Public.showVersion', ['token' => $token, 'versionId' => $version->getId()]))
				. '?r=' . rawurlencode((string)$reviewer->getSecretKey());
	}

	/** An absolute URL that works from a background job too, where the request knows no host */
	public function instanceUrl(string $path): string {
		$base = parse_url($this->config->getSystemValueString('overwrite.cli.url'));
		if (!isset($base['scheme'], $base['host'])) {
			return $this->urls->getAbsoluteURL($path);
		}
		return $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '') . $path;
	}
}
