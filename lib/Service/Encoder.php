<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCP\IAppConfig;

/**
 * The H.264 encoder for Proxies: libx264 by default, or a hardware encoder
 * the admin picked (spec: story 75). A hardware encoder is used only after a
 * one-second test encode passed, and a Proxy it fails on is made again in
 * software, so a bad setting never blocks the queue (story 76).
 */
class Encoder {
	public const NONE = 'none';
	public const VAAPI = 'vaapi';
	public const NVENC = 'nvenc';
	public const VIDEOTOOLBOX = 'videotoolbox';
	public const KINDS = [self::NONE, self::VAAPI, self::NVENC, self::VIDEOTOOLBOX];

	public const DEFAULT_DEVICE = '/dev/dri/renderD128';

	public function __construct(
		private Ffmpeg $ffmpeg,
		private IAppConfig $config,
	) {
	}

	/** The encoder Proxies are made with: the configured one if its test passed, else software */
	public function active(): string {
		$kind = $this->config->getValueString(Application::APP_ID, 'hw_encoder', self::NONE);
		return in_array($kind, self::KINDS, true) && $this->config->getValueBool(Application::APP_ID, 'hw_encoder_ok')
			? $kind
			: self::NONE;
	}

	public function device(): string {
		return $this->config->getValueString(Application::APP_ID, 'hw_device') ?: self::DEFAULT_DEVICE;
	}

	/**
	 * The ffmpeg arguments for one encoder, split by where they go.
	 *
	 * @param int $limit the largest short side, in pixels
	 * @param int $gop Frames between keyframes
	 * @return array{input: list<string>, filter: string, codec: list<string>}
	 */
	public function args(string $kind, int $limit, int $gop): array {
		// The limit applies to the short side, so portrait video keeps its detail;
		// the encoders need even dimensions
		$scale = "scale='if(gte(iw,ih),-2,min($limit,trunc(iw/2)*2))':'if(gte(iw,ih),min($limit,trunc(ih/2)*2),-2)'";
		$keyframes = ['-g', (string)max(1, $gop)];
		return match ($kind) {
			self::VAAPI => [
				'input' => ['-init_hw_device', 'vaapi=va:' . $this->device(), '-filter_hw_device', 'va'],
				'filter' => "$scale,format=nv12,hwupload",
				'codec' => ['-c:v', 'h264_vaapi', '-qp', '20', ...$keyframes],
			],
			self::NVENC => [
				'input' => [],
				'filter' => $scale,
				'codec' => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-pix_fmt', 'yuv420p', ...$keyframes],
			],
			self::VIDEOTOOLBOX => [
				'input' => [],
				'filter' => $scale,
				'codec' => ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p', ...$keyframes],
			],
			default => [
				'input' => [],
				'filter' => $scale,
				'codec' => ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...$keyframes],
			],
		};
	}

	/**
	 * Encodes one second of a test picture with the encoder.
	 *
	 * @return ?string null when it worked, else ffmpeg's error
	 */
	public function test(string $kind): ?string {
		$args = $this->args($kind, 360, 25);
		$result = $this->ffmpeg->run($this->ffmpeg->ffmpeg(), [
			'-v', 'error', '-nostdin',
			...$args['input'],
			'-f', 'lavfi', '-i', 'testsrc2=duration=1:size=640x360:rate=25',
			'-vf', $args['filter'],
			...$args['codec'],
			'-f', 'null', '-',
		], 60);
		return $result['code'] === 0 ? null : ($this->ffmpeg->tail($result['stderr']) ?: 'ffmpeg exited with ' . $result['code']);
	}
}
