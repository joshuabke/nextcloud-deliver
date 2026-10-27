<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\JobMapper;
use OCP\IAppConfig;

/**
 * The admin settings of the derived-media pipeline (spec: stories 74 to 77),
 * and the read-only status that goes with them.
 */
class PipelineSettings {
	/** Below 720p nobody reviews professionally */
	public const MIN_HEIGHT = 720;
	/** Setting => [type, default]; empty paths mean "whatever is on PATH" */
	private const SETTINGS = [
		'ffmpegPath' => ['ffmpeg_path', 'string', ''],
		'ffprobePath' => ['ffprobe_path', 'string', ''],
		'maxJobs' => ['max_jobs', 'int', 1],
		'maxHeight' => ['max_height', 'int', 1080],
		'thumbCap' => ['thumb_cap', 'int', 600],
		'hwEncoder' => ['hw_encoder', 'string', Encoder::NONE],
		'hwDevice' => ['hw_device', 'string', Encoder::DEFAULT_DEVICE],
		'extraArgs' => ['extra_args', 'string', ''],
		// Where a new Project's folder goes in each Member's Files, unless they pick another place (story 98)
		'projectFolder' => ['project_folder', 'string', '/Deliver'],
		// What one person may attach on one Version in all, in MB (story 92)
		'attachmentLimit' => ['attachment_mb', 'int', CommentService::ATTACHMENT_MB],
		// How long a Deleted Project is kept before it goes for good (story 151)
		'deletedDays' => ['deleted_days', 'int', 30],
	];
	/** The range of each number setting */
	private const BOUNDS = [
		'maxJobs' => [1, 16],
		'maxHeight' => [self::MIN_HEIGHT, 2160],
		'thumbCap' => [10, 5000],
		'attachmentLimit' => [1, 1024],
		'deletedDays' => [1, 365],
	];

	public function __construct(
		private IAppConfig $config,
		private Ffmpeg $ffmpeg,
		private Encoder $encoder,
		private JobMapper $jobs,
	) {
	}

	/** @return array<string, mixed> the settings, and how the last encoder test went */
	public function get(): array {
		$values = [];
		foreach (self::SETTINGS as $name => [$key, $type, $default]) {
			// A number saved before its range, or through occ, counts as the nearest one in range
			$values[$name] = $type === 'int'
				? min(self::BOUNDS[$name][1], max(self::BOUNDS[$name][0], $this->config->getValueInt(Application::APP_ID, $key, $default)))
				: ($this->config->getValueString(Application::APP_ID, $key) ?: $default);
		}
		return $values + [
			'hwEncoderOk' => $this->config->getValueBool(Application::APP_ID, 'hw_encoder_ok'),
			'hwEncoderError' => $this->config->getValueString(Application::APP_ID, 'hw_encoder_error') ?: null,
		];
	}

	/**
	 * Saves the settings that are given. A hardware encoder is tested with a
	 * one-second encode right away; if that fails it stays configured but
	 * unused, and Proxies are made in software (story 76).
	 *
	 * @param array<string, mixed> $changes
	 * @throws InvalidRequestException a value out of range
	 */
	public function save(array $changes): array {
		// Every value is checked before any is saved, so that a refused one leaves the others as they were
		$checked = [];
		foreach ($changes as $name => $value) {
			if ($value !== null && isset(self::SETTINGS[$name])) {
				$checked[$name] = self::SETTINGS[$name][1] === 'int' ? $this->bounded($name, (int)$value) : $this->checked($name, trim((string)$value));
			}
		}
		foreach ($checked as $name => $value) {
			is_int($value)
				? $this->config->setValueInt(Application::APP_ID, self::SETTINGS[$name][0], $value)
				: $this->config->setValueString(Application::APP_ID, self::SETTINGS[$name][0], $value);
		}
		$this->testEncoder();
		return $this->get();
	}

	private function testEncoder(): void {
		$kind = $this->config->getValueString(Application::APP_ID, 'hw_encoder', Encoder::NONE);
		$error = $kind === Encoder::NONE ? null : $this->encoder->test($kind);
		$this->config->setValueBool(Application::APP_ID, 'hw_encoder_ok', $kind !== Encoder::NONE && $error === null);
		$this->config->setValueString(Application::APP_ID, 'hw_encoder_error', $error ?? '');
	}

	private function bounded(string $name, int $value): int {
		[$min, $max] = self::BOUNDS[$name];
		if ($value < $min || $value > $max) {
			throw new InvalidRequestException("$name runs from $min to $max");
		}
		return $value;
	}

	private function checked(string $name, string $value): string {
		if ($name === 'hwEncoder' && !in_array($value, Encoder::KINDS, true)) {
			throw new InvalidRequestException('The hardware encoder is one of ' . implode(', ', Encoder::KINDS));
		}
		if (in_array($name, ['ffmpegPath', 'ffprobePath', 'hwDevice', 'projectFolder'], true) && $value !== '' && !str_starts_with($value, '/')) {
			throw new InvalidRequestException('A path starts at /');
		}
		return $value;
	}

	/**
	 * What the admin panel shows: whether the binaries answer, the queue,
	 * and the stderr of the last failed job (story 77).
	 *
	 * @return array<string, mixed>
	 */
	public function status(): array {
		return [
			'ffmpeg' => $this->ffmpeg->probe(),
			'ffprobe' => $this->ffmpeg->version($this->ffmpeg->ffprobe()),
			'encoder' => $this->encoder->active(),
			'states' => $this->jobs->countByState(),
			'lastError' => $this->jobs->findLastFailed()?->getStderrTail(),
		];
	}
}
