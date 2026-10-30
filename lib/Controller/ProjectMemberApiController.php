<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ProjectMembers;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** A Project's Members and what each may do, for Members with Manage (ADR 0016) */
class ProjectMemberApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectMembers $members,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/** Everyone who can open one of the Project's files, people and groups */
	#[NoAdminRequired]
	public function index(int $id): Response {
		return $this->guard(fn () => $this->members->list((string)$this->userId, $id));
	}

	/** Sets the level and the switches of a person or a group */
	#[NoAdminRequired]
	public function update(int $id, string $type, string $principal, string $level, bool $share = false, bool $approve = false): Response {
		return $this->guard(fn () => $this->members->set((string)$this->userId, $id, $type, $principal, $level, $share, $approve));
	}

	/** Takes back what was set: they have what Files gives them again */
	#[NoAdminRequired]
	public function destroy(int $id, string $type, string $principal): Response {
		return $this->guard(fn () => $this->members->reset((string)$this->userId, $id, $type, $principal));
	}
}
