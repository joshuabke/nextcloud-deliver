<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Version;
use OCP\Files\File;

/**
 * Reads a Version's metadata with ffprobe: the frame rate as a fraction, the
 * start timecode and the duration in Frames, the picture size and which
 * streams exist. Frames are the anchor (CONTEXT.md); seconds from ffprobe are
 * converted here and go no further.
 */
class Probe {
	public function __construct(
		private Ffmpeg $ffmpeg,
	) {
	}

	/**
	 * @return array<string, mixed>|null the metadata, or null when ffprobe
	 *                                   could not read the file
	 */
	public function read(string $path): ?array {
		$result = $this->ffmpeg->run($this->ffmpeg->ffprobe(), [
			'-v', 'error',
			'-print_format', 'json',
			'-show_format',
			'-show_streams',
			$path,
		], 120);
		if ($result['code'] !== 0) {
			return null;
		}
		$probed = json_decode($result['stdout'], true);
		return is_array($probed) ? $probed : null;
	}

	/**
	 * Writes what ffprobe found onto the Version. Audio has no frame rate of
	 * its own, so it gets the Project's, fixed from now on: its Frames must
	 * not change meaning when the Project setting changes later.
	 *
	 * @param array{0: int, 1: int} $projectFps the Project's default frame rate
	 * @return array<string, mixed>|null the raw ffprobe answer, or null when it could not read the file
	 */
	public function apply(Version $version, string $path, array $projectFps): ?array {
		$probed = $this->read($path);
		if ($probed === null) {
			return null;
		}
		$video = $this->stream($probed, 'video');
		$audio = $this->stream($probed, 'audio');
		$version->setHasVideo($video !== null);
		$version->setHasAudio($audio !== null);

		$fps = $this->rate($video['avg_frame_rate'] ?? null) ?? $this->rate($video['r_frame_rate'] ?? null);
		if ($fps === null && $video === null && $audio !== null) {
			$fps = $projectFps;
		}
		if ($fps !== null) {
			$version->setFpsNum($fps[0]);
			$version->setFpsDen($fps[1]);
		}
		if ($video !== null) {
			$version->setWidth((int)($video['width'] ?? 0));
			$version->setHeight((int)($video['height'] ?? 0));
		}

		$seconds = (float)($probed['format']['duration'] ?? $video['duration'] ?? $audio['duration'] ?? 0);
		$rate = $fps === null ? null : $fps[0] / $fps[1];
		if ($rate !== null && $seconds > 0) {
			$version->setDurationFrames((int)round($seconds * $rate));
		}

		$timecode = $probed['format']['tags']['timecode'] ?? $video['tags']['timecode'] ?? null;
		// A Broadcast WAV knows its place in the session as samples since midnight
		$timeReference = $probed['format']['tags']['time_reference'] ?? null;
		$sampleRate = (int)($audio['sample_rate'] ?? 0);
		if (is_string($timecode) && $rate !== null) {
			$version->setStartFrame(Timecode::toFrames($timecode, $fps[0], $fps[1]));
			$version->setDropFrame(str_contains($timecode, ';'));
		} elseif (is_numeric($timeReference) && $sampleRate > 0 && $rate !== null) {
			$version->setStartFrame((int)round((int)$timeReference / $sampleRate * $rate));
		}
		return $probed;
	}

	/**
	 * `24000/1001` stays a fraction; 23.976 would not be exact.
	 *
	 * @return array{0: int, 1: int}|null
	 */
	public function rate(?string $value): ?array {
		if ($value === null || !str_contains($value, '/')) {
			return null;
		}
		[$num, $den] = array_map('intval', explode('/', $value, 2));
		return $num > 0 && $den > 0 ? [$num, $den] : null;
	}

	/**
	 * The media streams, without cover art: an MP3 with an embedded picture is
	 * still audio only.
	 *
	 * @param array{streams?: list<array<string, mixed>>} $probed
	 * @return list<array<string, mixed>>
	 */
	public function streams(array $probed): array {
		return array_values(array_filter(
			$probed['streams'] ?? [],
			static fn (array $stream) => ($stream['disposition']['attached_pic'] ?? 0) !== 1,
		));
	}

	/** @return array<string, mixed>|null the first stream of a kind */
	private function stream(array $probed, string $kind): ?array {
		foreach ($this->streams($probed) as $stream) {
			if (($stream['codec_type'] ?? '') === $kind) {
				return $stream;
			}
		}
		return null;
	}

	/** A path ffmpeg can open; for storage that is not on local disk, Nextcloud makes a temporary copy */
	public function localPath(File $file): ?string {
		$path = $file->getStorage()->getLocalFile($file->getInternalPath());
		return is_string($path) && $path !== '' ? $path : null;
	}
}
