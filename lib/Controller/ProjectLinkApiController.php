<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ProjectLinkService;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** A Member's Project Links (ADR 0010), their Reviewers and activity */
class ProjectLinkApiController extends OCSController {
	use GuardsErrors;

	private const FIELDS = ['review', 'canComment', 'allowOlder', 'watermark', 'canDownload', 'latestOnly', 'label', 'description', 'password', 'expireDate', 'assetIds'];

	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectLinkService $projectLinks,
		private ReviewLinks $links,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function create(int $id): Response {
		return $this->guard(fn () => $this->projectLinks->create((string)$this->userId, $id), Http::STATUS_CREATED);
	}

	/** Takes only the fields given, so that assetIds: null can mean the whole Project again */
	#[NoAdminRequired]
	public function update(int $id): Response {
		$fields = array_intersect_key($this->request->getParams(), array_flip(self::FIELDS));
		return $this->guard(fn () => $this->projectLinks->update((string)$this->userId, $id, $fields));
	}

	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->guard(fn () => $this->projectLinks->delete((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function reviewers(int $id): Response {
		return $this->guard(fn () => $this->links->reviewersOf($this->projectLinks->ownLink((string)$this->userId, $id)));
	}

	#[NoAdminRequired]
	public function invite(int $id, string $name, ?string $email = null): Response {
		return $this->guard(fn () => $this->links->invite($this->projectLinks->ownLink((string)$this->userId, $id), $name, $email), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function activity(int $id): Response {
		return $this->guard(fn () => $this->links->activityOf($this->projectLinks->ownLink((string)$this->userId, $id)));
	}
}
