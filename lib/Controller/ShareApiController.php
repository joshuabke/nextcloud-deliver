<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ProjectService;
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
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(int $fileId): Response {
		return $this->guard(fn () => $this->sharing->linksFor((string)$this->userId, $fileId));
	}

	/** Every Share Link of mine in a Project, for its navigation (story 100) */
	#[NoAdminRequired]
	public function inProject(int $id): Response {
		return $this->guard(function () use ($id) {
			[, $folder] = $this->projects->resolve((string)$this->userId, $id);
			return $this->sharing->linksUnder((string)$this->userId, $folder);
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
