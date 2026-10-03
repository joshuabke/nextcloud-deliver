<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\ProjectService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** Projects, Assets and Version Stacks for Members; the folder's permissions decide */
class ProjectApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectService $service,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(): Response {
		return $this->guard(fn () => $this->service->listForUser((string)$this->userId));
	}

	#[NoAdminRequired]
	public function byFolder(int $folderId): Response {
		return $this->guard(fn () => $this->service->getForFolder((string)$this->userId, $folderId));
	}

	#[NoAdminRequired]
	public function show(int $id): Response {
		return $this->guard(fn () => $this->service->get((string)$this->userId, $id));
	}

	/** Sets the Asset's Due Date, or clears it with null (story 93) */
	#[NoAdminRequired]
	public function updateAsset(int $id, ?string $dueDate = null): Response {
		return $this->guard(fn () => $this->service->setDueDate((string)$this->userId, $id, $dueDate));
	}

	/** Puts the Asset into a Project, or into No Project for 0 (ADR 0009) */
	#[NoAdminRequired]
	public function assignAsset(int $id, int $projectId): Response {
		return $this->guard(fn () => $this->service->assign((string)$this->userId, $id, $projectId));
	}

	/** Who can be @mentioned on a Version: whoever can open its file */
	#[NoAdminRequired]
	public function members(int $id): Response {
		return $this->guard(fn () => $this->service->members((string)$this->userId, $id));
	}

	/** A Folder Project from a folder, or a Project by name */
	#[NoAdminRequired]
	public function create(?int $folderId = null, ?string $name = null, bool $autoIntake = true): Response {
		return $this->guard(fn () => $folderId === null
			? $this->service->createNamed((string)$this->userId, (string)$name)
			: $this->service->create((string)$this->userId, $folderId, $autoIntake), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function update(
		int $id,
		?bool $autoIntake = null,
		?bool $allowOlder = null,
		?int $fpsNum = null,
		?int $fpsDen = null,
		?string $timecodeMode = null,
		?string $name = null,
	): Response {
		return $this->guard(fn () => $this->service->updateSettings(
			(string)$this->userId, $id, $autoIntake, $allowOlder, $fpsNum, $fpsDen, $timecodeMode, $name,
		));
	}

	#[NoAdminRequired]
	public function mute(int $id, bool $muted): Response {
		return $this->guard(fn () => $this->service->setMuted((string)$this->userId, $id, $muted));
	}

	#[NoAdminRequired]
	public function updateVersion(int $id, ?int $number = null, ?bool $autoStacked = null): Response {
		return $this->guard(fn () => $this->service->updateVersion((string)$this->userId, $id, $number, $autoStacked));
	}

	#[NoAdminRequired]
	public function stackVersion(int $id, int $assetId, ?int $number = null): Response {
		return $this->guard(fn () => $this->service->stackVersion((string)$this->userId, $id, $assetId, $number));
	}

	#[NoAdminRequired]
	public function unstackVersion(int $id): Response {
		return $this->guard(fn () => $this->service->unstackVersion((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function regenerate(int $id): Response {
		return $this->guard(fn () => $this->service->regenerate((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function waveform(int $id, array $peaks = [], int $durationFrames = 0): Response {
		return $this->guard(fn () => $this->service->giveWaveform((string)$this->userId, $id, $peaks, $durationFrames));
	}

	/** Start, duration and Waveform from the tool that delivered the file, instead of a probe (ADR 0012) */
	#[NoAdminRequired]
	public function sidecar(int $id, float $start, float $duration, array $waveform): Response {
		return $this->guard(fn () => $this->service->giveSidecar((string)$this->userId, $id, $start, $duration, $waveform));
	}

	#[NoAdminRequired]
	public function version(int $id): Response {
		return $this->guard(fn () => $this->service->versionContext((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function assetForFile(int $fileId): Response {
		return $this->guard(fn () => $this->service->assetForFile((string)$this->userId, $fileId));
	}

	#[NoAdminRequired]
	public function enableFile(int $fileId, ?int $projectId = null): Response {
		return $this->guard(fn () => $this->service->enableFile((string)$this->userId, $fileId, $projectId), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function disableAsset(int $id): Response {
		return $this->guard(function () use ($id) {
			$this->service->disableAsset((string)$this->userId, $id);
			return [];
		});
	}

	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->guard(function () use ($id) {
			$this->service->remove((string)$this->userId, $id);
			return [];
		});
	}
}
