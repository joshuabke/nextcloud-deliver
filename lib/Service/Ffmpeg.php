<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCP\IAppConfig;
use Psr\Log\LoggerInterface;

/**
 * Runs ffmpeg and ffprobe. The paths come from the admin settings, else PATH.
 * ffmpeg is optional (ADR 0003): a missing binary is a failed run, not an exception.
 */
class Ffmpeg {
	public function __construct(
		private IAppConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/** The configured path, or whatever `ffmpeg` is on PATH */
	public function ffmpeg(): string {
		return $this->config->getValueString(Application::APP_ID, 'ffmpeg_path') ?: 'ffmpeg';
	}

	/** The configured path, or whatever `ffprobe` is on PATH */
	public function ffprobe(): string {
		return $this->config->getValueString(Application::APP_ID, 'ffprobe_path') ?: 'ffprobe';
	}

	/** @return ?string the first line of `-version`, or null when the binary is not there */
	public function version(string $binary): ?string {
		$result = $this->run($binary, ['-version'], 10);
		if ($result['code'] !== 0) {
			return null;
		}
		return strtok($result['stdout'], "\n") ?: null;
	}

	/**
	 * @param list<string> $args
	 * @param ?callable(string): void $onStdout gets stdout as it arrives, for progress
	 * @return array{code: int, stdout: string, stderr: string}
	 */
	public function run(string $binary, array $args, int $timeout = 3600, ?callable $onStdout = null): array {
		$descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
		$process = @proc_open([$binary, ...$args], $descriptors, $pipes);
		if (!is_resource($process)) {
			return ['code' => 127, 'stdout' => '', 'stderr' => "$binary not found"];
		}
		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);

		$stdout = '';
		$stderr = '';
		$deadline = time() + $timeout;
		$code = null;
		while ($code === null) {
			$chunk = (string)stream_get_contents($pipes[1]);
			$stdout .= $chunk;
			if ($chunk !== '' && $onStdout !== null) {
				$onStdout($chunk);
			}
			$stderr .= stream_get_contents($pipes[2]);
			$status = proc_get_status($process);
			if (!$status['running']) {
				// Before PHP 8.3 only this first status after the exit knows the code
				$code = $status['exitcode'];
			} elseif (time() > $deadline) {
				proc_terminate($process, 9);
				$stderr .= "\ntimed out after {$timeout}s";
				$code = 124;
			} else {
				usleep(20000);
			}
		}
		$stdout .= stream_get_contents($pipes[1]);
		$stderr .= stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		proc_close($process);

		if ($code !== 0) {
			$this->logger->debug('Deliver: ' . $binary . ' exited with ' . $code, ['stderr' => $this->tail($stderr)]);
		}
		return ['code' => $code, 'stdout' => $stdout, 'stderr' => $stderr];
	}

	/** The end of stderr, where ffmpeg puts the actual error */
	public function tail(string $stderr, int $bytes = 2000): string {
		return trim(mb_substr($stderr, -$bytes));
	}
}
