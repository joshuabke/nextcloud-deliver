<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ReviewerService;
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

	/**
	 * @throws AccessDeniedException the user may not write to the Reviewer's Project folder
	 */
	private function writableReviewer(int $id): \OCA\Deliver\Db\Reviewer {
		$reviewer = $this->reviewers->find($id);
		[, $folder] = $this->projects->resolve((string)$this->userId, $reviewer->getProjectId());
		if (!$this->projects->canWrite($folder)) {
			throw new AccessDeniedException('Write permission on the Project folder is required');
		}
		return $reviewer;
	}

	/** Every Share Link of mine in a Project, and the Project's Reviewers, for its navigation (story 100) */
	#[NoAdminRequired]
	public function inProject(int $id): Response {
		return $this->guard(function () use ($id) {
			[$project, $folder] = $this->projects->resolve((string)$this->userId, $id);
			$listed = $this->sharing->linksUnder((string)$this->userId, $project, $folder);
			$notEnabled = $this->projects->notEnabled($project, $folder, array_column($listed['links'], 'fileId'));
			$listed['links'] = array_map(static fn (array $link) => $link + ['notEnabled' => $notEnabled[$link['fileId']] ?? 0], $listed['links']);
			return $listed;
		});
	}

	#[NoAdminRequired]
	public function create(int $fileId): Response {
		return $this->guard(fn () => $this->sharing->createLink((string)$this->userId, $fileId), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function update(int $shareId, ?bool $review = null, ?bool $canComment = null, ?bool $allowOlder = null, ?bool $watermark = null): Response {
		return $this->guard(fn () => $this->sharing->serialize(
			$this->sharing->setFlags((string)$this->userId, $shareId, $review, $canComment, $allowOlder, $watermark),
		));
	}

	#[NoAdminRequired]
	public function reviewers(int $shareId): Response {
		return $this->guard(fn () => $this->sharing->reviewersOf((string)$this->userId, $shareId));
	}

	#[NoAdminRequired]
	public function invite(int $shareId, string $name, ?string $email = null): Response {
		return $this->guard(fn () => $this->sharing->invite((string)$this->userId, $shareId, $name, $email), Http::STATUS_CREATED);
	}
}
