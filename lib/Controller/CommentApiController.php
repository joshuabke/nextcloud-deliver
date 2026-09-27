<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\CommentService;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\Viewer;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** Comments for Members; the permissions on the Project folder decide what is allowed */
class CommentApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private CommentService $service,
		private ProjectService $projects,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(int $versionId): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->service->list($viewer, $version));
	}

	#[NoAdminRequired]
	public function changes(int $versionId, int $since = 0): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->service->changes($viewer, $version, $since));
	}

	#[NoAdminRequired]
	public function create(int $versionId, int $inFrame, ?int $outFrame = null, string $body = '', ?int $parentId = null): Response {
		return $this->onVersion(
			$versionId,
			fn ($viewer, $version) => $this->service->create($viewer, $version, $inFrame, $outFrame, $body, $parentId),
			Http::STATUS_CREATED,
		);
	}

	#[NoAdminRequired]
	public function seen(int $versionId, ?int $at = null): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->service->markSeen($viewer, $version, $at));
	}

	#[NoAdminRequired]
	public function update(int $id, string $body): Response {
		return $this->onComment($id, fn ($viewer, $version) => $this->service->update($viewer, $version, $id, $body));
	}

	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->onComment($id, function (Viewer $viewer, $version) use ($id) {
			$this->service->remove($viewer, $version, $id);
			return [];
		});
	}

	#[NoAdminRequired]
	public function resolve(int $id, bool $resolved): Response {
		return $this->onComment($id, fn ($viewer, $version) => $this->service->setResolved($viewer, $version, $id, $resolved));
	}

	private function onVersion(int $versionId, callable $action, int $status = Http::STATUS_OK): Response {
		return $this->guard(function () use ($versionId, $action) {
			[$viewer, $version] = $this->projects->viewerForVersion((string)$this->userId, $versionId);
			return $action($viewer, $version);
		}, $status);
	}

	private function onComment(int $id, callable $action): Response {
		return $this->guard(function () use ($id, $action) {
			[$viewer, $version] = $this->projects->viewerForVersion(
				(string)$this->userId,
				$this->service->versionIdOf($id),
			);
			return $action($viewer, $version);
		});
	}
}
