<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\ProjectLinkService;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLinks;
use OCA\Deliver\Service\ShareReviewService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** Review switches on a Member's Share Links, and the Reviewers invited through them (ADR 0004) */
class ShareApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ShareReviewService $sharing,
		private ProjectService $projects,
		private ReviewerService $reviewers,
		private ReviewLinks $links,
		private ProjectLinkService $projectLinks,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(int $fileId): Response {
		return $this->guard(fn () => $this->sharing->linksFor((string)$this->userId, $fileId));
	}

	/** A Member edits a Reviewer of a Project they can write to: name, address, mail wishes, own rights */
	#[NoAdminRequired]
	public function updateReviewer(
		int $id,
		string $name,
		?string $email = null,
		?bool $mailReplies = null,
		?bool $mailComments = null,
		?bool $mailVersions = null,
		?array $rights = null,
	): Response {
		return $this->guard(function () use ($id, $name, $email, $mailReplies, $mailComments, $mailVersions, $rights) {
			$reviewer = $this->writableReviewer($id);
			$wishes = ['replies' => $mailReplies, 'comments' => $mailComments, 'versions' => $mailVersions];
			return $this->reviewers->serialize($this->reviewers->update($reviewer, $name, $email, $wishes, $rights));
		});
	}

	/** A new Personal Link for a Reviewer; the old ones stop working */
	#[NoAdminRequired]
	public function renewReviewerKey(int $id): Response {
		return $this->guard(fn () => $this->reviewers->serialize($this->reviewers->renewKey($this->writableReviewer($id))));
	}

	/** The Reviewer's Personal Links stop working and they leave the lists; their Comments stay */
	#[NoAdminRequired]
	public function removeReviewer(int $id): Response {
		return $this->guard(fn () => $this->reviewers->remove($this->writableReviewer($id)));
	}

	/**
	 * @throws AccessDeniedException the Reviewer is another Member's (ADR 0009)
	 */
	private function writableReviewer(int $id): \OCA\Deliver\Db\Reviewer {
		$reviewer = $this->reviewers->find($id);
		if ($reviewer->getOwnerUid() !== (string)$this->userId) {
			throw new AccessDeniedException('Only the Member a Reviewer belongs to changes them');
		}
		return $reviewer;
	}

	/**
	 * My Project Links of a Project, my Share Links on its folder or files,
	 * and my Reviewers who came by any of them, paused or not, each with their
	 * Personal Link through every one with review on, for its navigation (story 100)
	 */
	#[NoAdminRequired]
	public function inProject(int $id): Response {
		return $this->guard(function () use ($id) {
			$uid = (string)$this->userId;
			[$project, $folder, $fileIds] = $this->projects->filesOf($uid, $id);
			$links = $this->sharing->linksUnder($uid, $folder, $fileIds);
			$notEnabled = $project === null ? [] : $this->projects->notEnabled($uid, $project, array_column($links, 'fileId'));
			$projectLinks = $project === null ? [] : $this->projectLinks->listFor($uid, $project->getId());
			$all = [...$projectLinks, ...$links];
			$live = array_filter($all, static fn (array $link) => $link['review']);
			['reviewers' => $reviewers, 'cameBy' => $cameBy] = $this->links->reviewersBy($uid, array_column($all, 'token'), array_column($live, 'url', 'token'));
			$withReviewers = static fn (array $link) => $link + ['reviewerIds' => $cameBy[$link['token']] ?? []];
			return [
				'projectLinks' => array_map($withReviewers, $projectLinks),
				'links' => array_map(static fn (array $link) => $withReviewers($link) + ['notEnabled' => $notEnabled[$link['fileId']] ?? 0], $links),
				'reviewers' => $reviewers,
			];
		});
	}

	#[NoAdminRequired]
	public function create(int $fileId): Response {
		return $this->guard(fn () => $this->sharing->createLink((string)$this->userId, $fileId), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function update(
		int $shareId,
		?bool $review = null,
		?bool $canComment = null,
		?bool $allowOlder = null,
		?bool $watermark = null,
		?string $password = null,
		?string $expireDate = null,
		?bool $latestOnly = null,
		?bool $canDownload = null,
		?string $description = null,
	): Response {
		return $this->guard(function () use ($shareId, $review, $canComment, $allowOlder, $watermark, $password, $expireDate, $latestOnly, $canDownload, $description) {
			if ($password !== null || $expireDate !== null) {
				$this->sharing->protect((string)$this->userId, $shareId, $password, $expireDate);
			}
			return $this->sharing->serialize(
				$this->sharing->setFlags((string)$this->userId, $shareId, $review, $canComment, $allowOlder, $watermark, $latestOnly, $canDownload, $description),
			);
		});
	}

	#[NoAdminRequired]
	public function destroy(int $shareId): Response {
		return $this->guard(fn () => $this->sharing->deleteLink((string)$this->userId, $shareId));
	}

	#[NoAdminRequired]
	public function reviewers(int $shareId): Response {
		return $this->guard(fn () => $this->links->reviewersOf($this->sharing->ownLink((string)$this->userId, $shareId)));
	}

	#[NoAdminRequired]
	public function invite(int $shareId, string $name, ?string $email = null): Response {
		return $this->guard(fn () => $this->links->invite($this->sharing->ownLink((string)$this->userId, $shareId), $name, $email), Http::STATUS_CREATED);
	}

	/** Who opened the link, watched and downloaded what (story 124) */
	#[NoAdminRequired]
	public function activity(int $shareId): Response {
		return $this->guard(fn () => $this->links->activityOf($this->sharing->ownLink((string)$this->userId, $shareId)));
	}
}
