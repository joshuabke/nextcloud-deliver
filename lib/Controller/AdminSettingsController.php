<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\PipelineSettings;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** The derived-media settings; admins only, which is the framework's default */
class AdminSettingsController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private PipelineSettings $settings,
	) {
		parent::__construct($appName, $request);
	}

	public function show(): Response {
		return $this->guard(fn () => ['settings' => $this->settings->get(), 'status' => $this->settings->status()]);
	}

	public function update(
		?string $ffmpegPath = null,
		?string $ffprobePath = null,
		?int $maxJobs = null,
		?int $maxHeight = null,
		?int $thumbCap = null,
		?string $hwEncoder = null,
		?string $hwDevice = null,
		?string $extraArgs = null,
	): Response {
		$changes = [
			'ffmpegPath' => $ffmpegPath,
			'ffprobePath' => $ffprobePath,
			'maxJobs' => $maxJobs,
			'maxHeight' => $maxHeight,
			'thumbCap' => $thumbCap,
			'hwEncoder' => $hwEncoder,
			'hwDevice' => $hwDevice,
			'extraArgs' => $extraArgs,
		];
		return $this->guard(fn () => ['settings' => $this->settings->save($changes), 'status' => $this->settings->status()]);
	}
}
