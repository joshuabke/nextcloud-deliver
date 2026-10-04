<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ProjectLinkService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** A Member's Project Links (ADR 0010, 0011), their Reviewers and activity */
class ProjectLinkApiController extends OCSController {
	use GuardsErrors;

	private const FIELDS = [...ReviewLink::FLAGS, 'label', 'description', 'password', 'expireDate', 'assetIds'];

	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectLinkService $projectLinks,
		private ReviewLinks $links,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * My links on a Project, or on No Project for 0, and my Reviewers who came
	 * by any of them, paused or not, each with their Personal Link through
	 * every live one, for its navigation (story 100)
	 */
	#[NoAdminRequired]
	public function index(int $id): Response {
		return $this->guard(function () use ($id) {
			$uid = (string)$this->userId;
			$links = $this->projectLinks->listFor($uid, $id);
			$live = array_filter($links, static fn (array $link) => $link['review']);
			['reviewers' => $reviewers, 'cameBy' => $cameBy] = $this->links->reviewersBy($uid, array_column($links, 'token'), array_column($live, 'url', 'token'));
			return [
				'links' => array_map(static fn (array $link) => $link + ['reviewerIds' => $cameBy[$link['token']] ?? []], $links),
				'reviewers' => $reviewers,
			];
		});
	}

	/** @param ?list<int> $assetIds only these Assets; required on No Project (0) */
	#[NoAdminRequired]
	public function create(int $id, ?array $assetIds = null): Response {
		return $this->guard(fn () => $this->projectLinks->create((string)$this->userId, $id, $assetIds), Http::STATUS_CREATED);
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
