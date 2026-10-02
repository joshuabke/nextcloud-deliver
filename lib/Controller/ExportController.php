<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Http\RangeFileResponse;
use OCA\Deliver\Service\ExportService;
use OCA\Deliver\Service\ProjectService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;

/** A Version's Comments as a file for the editing application; a plain download, so no OCS */
class ExportController extends Controller {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ExportService $exports,
		private ProjectService $projects,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function download(int $id, string $format, bool $unresolvedOnly = false, bool $zeroBased = false): Response {
		return $this->respond($id, $format, $unresolvedOnly, $zeroBased, null);
	}

	/** The Ableton export: the person's own Live Set goes in, the same set with locators comes out */
	#[NoAdminRequired]
	public function liveSet(int $id, bool $unresolvedOnly = false, bool $zeroBased = false): Response {
		$upload = $this->request->getUploadedFile('set');
		$set = is_array($upload) && ($upload['error'] ?? 1) === UPLOAD_ERR_OK ? file_get_contents($upload['tmp_name']) : false;
		return $this->respond($id, 'ableton', $unresolvedOnly, $zeroBased, $set === false ? null : $set);
	}

	private function respond(int $id, string $format, bool $unresolvedOnly, bool $zeroBased, ?string $liveSet): Response {
		return $this->guard(function () use ($id, $format, $unresolvedOnly, $zeroBased, $liveSet) {
			[$viewer, $version] = $this->projects->viewerForVersion((string)$this->userId, $id);
			$project = $this->projects->settingsOf($version);
			$file = $this->exports->export($viewer, $version, $project, $format, $unresolvedOnly, $zeroBased, $liveSet);
			if (!isset($file['path'])) {
				return new DataDownloadResponse($file['body'], $file['name'], $file['mime']);
			}
			// A temporary file, streamed and then deleted
			$path = $file['path'];
			register_shutdown_function(static fn () => @unlink($path));
			$response = new RangeFileResponse(fn () => fopen($path, 'rb'), (int)filesize($path), $file['mime'], md5($path), null);
			$response->addHeader('Content-Disposition', 'attachment; filename="' . rawurlencode($file['name']) . '"; filename*=UTF-8\'\'' . rawurlencode($file['name']));
			return $response;
		});
	}
}
