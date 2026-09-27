<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Job;
use OCA\Deliver\Db\JobMapper;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IAppConfig;

/**
 * Proxies, Thumbnail Strips and Waveforms (ADR 0003). They live in app data,
 * never in a user's folder, and a Version plays without them whenever the
 * browser can handle the original.
 */
class DerivedMedia {
	public const STATE_NONE = 'none';
	public const STATE_QUEUED = 'queued';
	public const STATE_RUNNING = 'running';
	public const STATE_READY = 'ready';
	public const STATE_FAILED = 'failed';

	/** The app data file of each kind */
	public const FILES = [
		'proxy' => 'proxy.mp4',
		'thumbs' => 'thumbs.webp',
		'thumbsIndex' => 'thumbs.json',
		'waveform' => 'waveform.json',
	];

	/** Codecs a browser plays in each container family, by their ffprobe names */
	private const PLAYABLE = [
		'mp4' => ['video' => ['h264'], 'audio' => ['aac', 'mp3']],
		'webm' => ['video' => ['vp8', 'vp9', 'av1'], 'audio' => ['opus', 'vorbis']],
	];

	private const THUMB_WIDTH = 160;
	private const WAVEFORM_BUCKETS = 2000;
	/** Seconds between two progress writes to the job row */
	private const PROGRESS_INTERVAL = 2;

	/** @var array{job: Job, seconds: float, percent: int, written: int}|null the job ffmpeg is working on */
	private ?array $running = null;

	public function __construct(
		private Ffmpeg $ffmpeg,
		private Encoder $encoder,
		private Probe $probe,
		private VersionMapper $versions,
		private ProjectMapper $projects,
		private JobMapper $jobs,
		private IRootFolder $root,
		private IAppDataFactory $appDataFactory,
		private IAppConfig $config,
		private ITimeFactory $time,
	) {
	}

	/** Queues the probe, which then queues whatever else the Version needs */
	public function queue(int $versionId): void {
		$this->enqueue($versionId, Job::KIND_PROBE);
	}

	/** Deletes the derived media of a Version and queues it again */
	public function regenerate(int $versionId): void {
		$this->forget($versionId);
		$this->queue($versionId);
	}

	private function enqueue(int $versionId, string $kind): void {
		if ($this->jobs->findPending($versionId, $kind) !== null) {
			return;
		}
		$job = new Job();
		$job->setKind($kind);
		$job->setVersionId($versionId);
		$job->setState(Job::STATE_QUEUED);
		$job->setCreatedAt($this->time->getTime());
		$this->jobs->insert($job);
		$this->mark($versionId, $kind, self::STATE_QUEUED);
	}

	/**
	 * Runs one claimed job. A done job is deleted; a failed one stays with its
	 * stderr for the admin panel. Failures are never thrown, so an install
	 * without ffmpeg keeps working.
	 */
	public function process(Job $job): void {
		$version = $this->versions->find($job->getVersionId());
		if ($version === null) {
			$this->jobs->delete($job);
			return;
		}
		$this->mark($version->getId(), $job->getKind(), self::STATE_RUNNING);
		try {
			$file = $this->fileOf($version);
			$path = $file === null ? null : $this->probe->localPath($file);
			if ($path === null) {
				throw new \RuntimeException('The file of this Version is not readable');
			}
			$this->running = ['job' => $job, 'seconds' => $this->durationSeconds($version), 'percent' => 0, 'written' => 0];
			match ($job->getKind()) {
				Job::KIND_PROBE => $this->runProbe($version, $path),
				Job::KIND_PROXY => $this->runProxy($version, $path),
				Job::KIND_THUMBS => $this->runThumbs($version, $path),
				Job::KIND_WAVEFORM => $this->runWaveform($version, $path),
				default => throw new \RuntimeException('Unknown job kind ' . $job->getKind()),
			};
			$this->mark($version->getId(), $job->getKind(), self::STATE_READY);
			$this->jobs->delete($job);
		} catch (\Throwable $e) {
			$error = $this->ffmpeg->tail($e->getMessage());
			$this->mark($version->getId(), $job->getKind(), self::STATE_FAILED, $error);
			$job->setState(Job::STATE_FAILED);
			$job->setStderrTail($error);
			$job->setFinishedAt($this->time->getTime());
			$this->jobs->update($job);
		} finally {
			$this->running = null;
		}
	}

	private function runProbe(Version $version, string $path): void {
		$project = $this->projects->find($version->getProjectId());
		$probed = $this->probe->apply($version, $path, [$project->getFpsNum(), $project->getFpsDen()]);
		if ($probed === null) {
			throw new \RuntimeException('ffprobe could not read this file');
		}
		$this->versions->update($version);

		$playable = $this->browserPlays($probed);
		$version->setPlayable($playable);
		$this->versions->update($version);
		// A Proxy either makes the Version playable at all or is the lighter choice next to a large original
		if ($version->getHasVideo() && (!$playable || $this->oversized($probed))) {
			$this->enqueue($version->getId(), Job::KIND_PROXY);
		}
		if ($version->getHasVideo()) {
			$this->enqueue($version->getId(), Job::KIND_THUMBS);
		}
		if ($version->getHasAudio()) {
			$this->enqueue($version->getId(), Job::KIND_WAVEFORM);
		}
	}

	/**
	 * H.264/AAC MP4 at exactly the source frame rate, because every Frame
	 * anchor depends on it (ADR 0003). A variable rate is conformed to its
	 * average. When the hardware encoder fails, the Proxy is made in software.
	 */
	private function runProxy(Version $version, string $path): void {
		$encoder = $this->encoder->active();
		try {
			$this->store($version, 'proxy', fn (string $output) => $this->ffmpeg($this->proxyArgs($version, $path, $encoder, $output)));
		} catch (\RuntimeException $e) {
			if ($encoder === Encoder::NONE) {
				throw $e;
			}
			$this->store($version, 'proxy', fn (string $output) => $this->ffmpeg($this->proxyArgs($version, $path, Encoder::NONE, $output)));
		}
	}

	/** @return list<string> */
	private function proxyArgs(Version $version, string $path, string $encoder, string $output): array {
		$num = $version->getFpsNum();
		$den = $version->getFpsDen();
		// A keyframe every second, so seeking stays quick
		$args = $this->encoder->args($encoder, $this->maxHeight(), $num && $den ? (int)round($num / $den) : 25);
		return [
			...$args['input'],
			'-i', $path,
			'-map', '0:v:0', '-map', '0:a:0?',
			'-vf', $args['filter'],
			...($num && $den ? ['-r', "$num/$den"] : []),
			...$args['codec'],
			'-c:a', 'aac', '-b:a', '160k',
			...$this->extraArgs(),
			'-movflags', '+faststart',
			'-f', 'mp4', $output,
		];
	}

	/** @return list<string> the admin's extra ffmpeg arguments for the Proxy */
	private function extraArgs(): array {
		return self::splitArgs($this->config->getValueString(Application::APP_ID, 'extra_args'));
	}

	/**
	 * Splits an argument line the way a shell would: at spaces, except inside
	 * single or double quotes, which are then removed.
	 *
	 * @return list<string>
	 */
	public static function splitArgs(string $line): array {
		preg_match_all('/(?:[^\s"\']+|"[^"]*"|\'[^\']*\')+/', $line, $matches);
		return array_map(static fn (string $arg) => (string)preg_replace('/"([^"]*)"|\'([^\']*)\'/', '$1$2', $arg), $matches[0]);
	}

	/** About one Frame per second in a WebP grid, capped by the admin setting */
	private function runThumbs(Version $version, string $path): void {
		$cap = max(1, $this->config->getValueInt(Application::APP_ID, 'thumb_cap', 600));
		$duration = $this->durationSeconds($version);
		$every = max(1, (int)ceil($duration / $cap));
		$count = max(1, min($cap, (int)ceil($duration / $every)));
		$columns = (int)ceil(sqrt($count));
		$rows = (int)ceil($count / $columns);

		$this->store($version, 'thumbs', fn (string $output) => $this->ffmpeg([
			'-i', $path,
			'-vf', "fps=1/$every,scale=" . self::THUMB_WIDTH . ":-2,tile={$columns}x{$rows}",
			'-frames:v', '1',
			'-f', 'webp', $output,
		]));
		$this->put($version, 'thumbsIndex', json_encode([
			'every' => $every,
			'count' => $count,
			'columns' => $columns,
			'rows' => $rows,
			'width' => self::THUMB_WIDTH,
			'fps' => ['num' => $version->getFpsNum(), 'den' => $version->getFpsDen()],
		], JSON_THROW_ON_ERROR));
	}

	/** Mono 8 kHz PCM from ffmpeg, reduced to peaks without another binary */
	private function runWaveform(Version $version, string $path): void {
		$pcm = tempnam(sys_get_temp_dir(), 'deliver-') ?: throw new \RuntimeException('No temporary file for the Waveform');
		try {
			$this->ffmpeg([
				'-i', $path,
				'-map', '0:a:0', '-ac', '1', '-ar', '8000',
				'-c:a', 'pcm_s16le', '-f', 's16le', $pcm,
			]);
			$peaks = self::peaks($pcm, self::WAVEFORM_BUCKETS);
		} finally {
			@unlink($pcm);
		}
		$this->put($version, 'waveform', json_encode(['peaks' => $peaks], JSON_THROW_ON_ERROR));
	}

	/**
	 * Reads the PCM in chunks, one per bucket, so an hour of audio does not
	 * have to fit into memory.
	 *
	 * @return list<float> the loudest sample of each bucket, 0 to 1
	 */
	public static function peaks(string $pcmFile, int $buckets): array {
		$samples = intdiv((int)filesize($pcmFile), 2);
		$perBucket = max(1, (int)ceil($samples / $buckets));
		$handle = fopen($pcmFile, 'rb');
		$peaks = [];
		while (($chunk = fread($handle, $perBucket * 2)) !== false && strlen($chunk) >= 2) {
			$loudest = max(array_map('abs', unpack('s*', $chunk)));
			$peaks[] = round(min(1, $loudest / 32767), 3);
		}
		fclose($handle);
		return $peaks;
	}

	/**
	 * Whether browsers play the original: H.264/AAC in MP4 and VP8/VP9/AV1
	 * with Opus/Vorbis in WebM, at any size (spec: Media metadata and derived media).
	 */
	private function browserPlays(array $probed): bool {
		$format = (string)($probed['format']['format_name'] ?? '');
		$family = match (true) {
			str_contains($format, 'mp4') => 'mp4',
			str_contains($format, 'webm') => 'webm',
			default => null,
		};
		if ($family === null) {
			return false;
		}
		foreach ($this->probe->streams($probed) as $stream) {
			$kind = (string)($stream['codec_type'] ?? '');
			$codec = (string)($stream['codec_name'] ?? '');
			if (!isset(self::PLAYABLE[$family][$kind])) {
				continue;
			}
			if (!in_array($codec, self::PLAYABLE[$family][$kind], true)) {
				return false;
			}
			// 10-bit or 4:2:2 H.264 is still H.264, but browsers do not decode it
			if ($codec === 'h264' && !in_array($stream['pix_fmt'] ?? '', ['yuv420p', 'yuvj420p'], true)) {
				return false;
			}
		}
		return true;
	}

	/** Whether the picture is larger than the Proxy limit, measured on its short side (1080p also for portrait) */
	private function oversized(array $probed): bool {
		foreach ($this->probe->streams($probed) as $stream) {
			if (($stream['codec_type'] ?? '') === 'video'
				&& min((int)($stream['width'] ?? 0), (int)($stream['height'] ?? 0)) > $this->maxHeight()) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Runs ffmpeg and reports its progress on the running job.
	 *
	 * @param list<string> $args
	 * @throws \RuntimeException with ffmpeg's stderr when it fails
	 */
	private function ffmpeg(array $args): void {
		$result = $this->ffmpeg->run(
			$this->ffmpeg->ffmpeg(),
			['-y', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats', ...$args],
			3600,
			fn (string $chunk) => $this->progressed($chunk),
		);
		if ($result['code'] !== 0) {
			throw new \RuntimeException($result['stderr'] ?: 'ffmpeg exited with ' . $result['code']);
		}
	}

	/** Reads `out_time_us` from ffmpeg's progress output and writes the percentage now and then */
	private function progressed(string $chunk): void {
		if ($this->running === null || preg_match_all('/^out_time_us=(\d+)/m', $chunk, $m) === 0) {
			return;
		}
		$percent = self::percent((int)end($m[1]), $this->running['seconds']);
		$now = $this->time->getTime();
		if ($percent > $this->running['percent'] && $now - $this->running['written'] >= self::PROGRESS_INTERVAL) {
			$this->jobs->setProgress($this->running['job']->getId(), $percent);
			$this->running['percent'] = $percent;
			$this->running['written'] = $now;
		}
	}

	/** Never 100 before the job is actually done */
	public static function percent(int $microseconds, float $duration): int {
		return $duration > 0 ? max(0, min(99, (int)floor($microseconds / 1e4 / $duration))) : 0;
	}

	/** @return ?int how far the running job of a Version has got, in percent; null when none runs */
	public function progress(Version $version): ?int {
		foreach ([Job::KIND_PROXY, Job::KIND_THUMBS, Job::KIND_WAVEFORM] as $kind) {
			$job = $this->jobs->findPending($version->getId(), $kind);
			if ($job?->getState() === Job::STATE_RUNNING) {
				return $job->getProgress();
			}
		}
		return null;
	}

	/**
	 * Has ffmpeg write into a temporary file and streams that into app data.
	 *
	 * @param callable(string): void $render writes to the path it is given
	 */
	private function store(Version $version, string $kind, callable $render): void {
		$temporary = tempnam(sys_get_temp_dir(), 'deliver-');
		try {
			$render($temporary);
			if ((int)filesize($temporary) === 0) {
				throw new \RuntimeException('ffmpeg wrote nothing');
			}
			$handle = fopen($temporary, 'rb');
			$this->put($version, $kind, $handle);
			if (is_resource($handle)) {
				fclose($handle);
			}
		} finally {
			@unlink($temporary);
		}
	}

	/** @param string|resource $content */
	private function put(Version $version, string $kind, $content): void {
		$folder = $this->folder($version->getId());
		try {
			$file = $folder->getFile(self::FILES[$kind]);
		} catch (NotFoundException) {
			$file = $folder->newFile(self::FILES[$kind]);
		}
		$file->putContent($content);
	}

	/** The Version's folder in app data, `appdata_<instance>/deliver/<version id>/` (spec) */
	private function folder(int $versionId): ISimpleFolder {
		$appData = $this->appDataFactory->get(Application::APP_ID);
		try {
			return $appData->getFolder((string)$versionId);
		} catch (NotFoundException) {
			return $appData->newFolder((string)$versionId);
		}
	}

	/** @throws NotFoundException nothing of that kind exists for the Version */
	public function file(Version $version, string $kind): ISimpleFile {
		if (!isset(self::FILES[$kind])) {
			throw new NotFoundException('Unknown kind of derived media: ' . $kind);
		}
		// Looking must not create the folder
		return $this->appDataFactory->get(Application::APP_ID)->getFolder((string)$version->getId())->getFile(self::FILES[$kind]);
	}

	/** Deletes the derived media and open jobs of a Version */
	public function forget(int $versionId): void {
		$this->jobs->deleteByVersion($versionId);
		$version = $this->versions->find($versionId);
		if ($version !== null) {
			$version->setProxyState(self::STATE_NONE);
			$version->setThumbsState(self::STATE_NONE);
			$version->setWaveformState(self::STATE_NONE);
			$version->setDerivedError(null);
			$this->versions->update($version);
		}
		try {
			$this->appDataFactory->get(Application::APP_ID)->getFolder((string)$versionId)->delete();
		} catch (NotFoundException) {
			// nothing was generated
		}
	}

	/** @return array{states: array<string, int>, lastError: ?string} for the admin panel */
	public function status(): array {
		return [
			'states' => $this->jobs->countByState(),
			'lastError' => $this->jobs->findLastFailed()?->getStderrTail(),
		];
	}

	public function maxHeight(): int {
		return $this->config->getValueInt(Application::APP_ID, 'max_height', 1080);
	}

	/** Only to space the thumbnails; an unknown length counts as a minute */
	private function durationSeconds(Version $version): float {
		$frames = $version->getDurationFrames();
		$num = $version->getFpsNum();
		$den = $version->getFpsDen();
		if ($frames === null || !$num || !$den) {
			return 60.0;
		}
		return $frames * $den / $num;
	}

	private function fileOf(Version $version): ?File {
		foreach ($this->root->getById($version->getFileId()) as $node) {
			if ($node instanceof File) {
				return $node;
			}
		}
		return null;
	}

	/** Sets the state of one kind on the Version; a failure also records its error */
	private function mark(int $versionId, string $kind, string $state, ?string $error = null): void {
		$version = $this->versions->find($versionId);
		if ($version === null) {
			return;
		}
		match ($kind) {
			Job::KIND_PROXY => $version->setProxyState($state),
			Job::KIND_THUMBS => $version->setThumbsState($state),
			Job::KIND_WAVEFORM => $version->setWaveformState($state),
			default => null,
		};
		if ($error !== null) {
			$version->setDerivedError($error);
		}
		$this->versions->update($version);
	}
}
