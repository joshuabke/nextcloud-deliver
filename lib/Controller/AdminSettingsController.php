<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\DerivedMedia;
use OCA\Deliver\Service\PipelineSettings;
use OCA\Deliver\Service\SupportReport;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** The derived-media settings and troubleshooting; admins only, which is the framework's default */
class AdminSettingsController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private PipelineSettings $settings,
		private DerivedMedia $media,
		private SupportReport $report,
	) {
		parent::__construct($appName, $request);
	}

	/** For a bug report: versions, pipeline, queue and failures, without names or comments */
	public function report(): Response {
		return $this->guard(fn () => $this->report->build());
	}

	/** Queues every failed media job again */
	public function retry(): Response {
		return $this->guard(fn () => ['retried' => $this->media->retryFailed(), 'status' => $this->settings->status()]);
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
