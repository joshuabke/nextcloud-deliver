<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Job;
use OCA\Deliver\Db\JobMapper;
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
use Psr\Log\LoggerInterface;

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
		// Audio files: a picture in them is cover art at most, and anything else is no audio file
		'mp3' => ['video' => [], 'audio' => ['mp3']],
		'aac' => ['video' => [], 'audio' => ['aac']],
		'flac' => ['video' => [], 'audio' => ['flac']],
		'ogg' => ['video' => [], 'audio' => ['vorbis', 'opus', 'flac']],
		'wav' => ['video' => [], 'audio' => ['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le']],
		// Only read without ffmpeg (ffprobe says matroska,webm): Chrome and Firefox play these, Safari tells its user to switch
		'matroska' => ['video' => ['h264', 'vp8', 'vp9', 'av1'], 'audio' => ['aac', 'opus', 'vorbis', 'flac', 'mp3']],
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
		private ContainerProbe $container,
		private VersionMapper $versions,
		private JobMapper $jobs,
		private IRootFolder $root,
		private IAppDataFactory $appDataFactory,
		private IAppConfig $config,
		private ITimeFactory $time,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Queues every failed job again, for instance once ffmpeg is installed or fixed
	 *
	 * @return int how many
	 */
	public function retryFailed(): int {
		$failed = $this->jobs->findFailed();
		foreach ($failed as $job) {
			$this->jobs->delete($job);
			$this->enqueue($job->getVersionId(), (string)$job->getKind());
		}
		return count($failed);
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
				Job::KIND_PROBE => Reviewable::image($file->getMimeType()) ? $this->measureImage($version, $path) : $this->runProbe($version, $path),
				Job::KIND_PROXY => $this->runProxy($version, $path),
				Job::KIND_THUMBS => $this->runThumbs($version, $path),
				Job::KIND_WAVEFORM => $this->runWaveform($version, $path),
				default => throw new \RuntimeException('Unknown job kind ' . $job->getKind()),
			};
			$this->mark($version->getId(), $job->getKind(), self::STATE_READY);
			$this->jobs->delete($job);
		} catch (\Throwable $e) {
			$error = $this->ffmpeg->tail($e->getMessage());
			// Into Nextcloud's log too, where an admin without a shell looks first
			$this->logger->warning('Deliver could not make the {kind} of Version {version}', ['kind' => $job->getKind(), 'version' => $version->getId(), 'exception' => $e]);
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
		$probed = $this->probe->apply($version, $path);
		if ($probed === null) {
			throw new \RuntimeException($this->ffmpeg->version($this->ffmpeg->ffprobe()) === null
				? 'Without ffmpeg, Deliver cannot read this format'
				: 'ffprobe could not read this file');
		}
		$playable = $this->browserPlays($probed);
		$version->setPlayable($playable);
		$this->versions->update($version);
		// Read without ffprobe: there is no ffmpeg either, so nothing to queue that could only fail.
		// A WAV's Waveform is in its PCM; other audio gets one from the browser (acceptWaveform).
		if ($probed['fallback'] ?? false) {
			$peaks = $version->getHasAudio() ? $this->container->wavPeaks($path, self::WAVEFORM_BUCKETS) : null;
			if ($peaks !== null) {
				$this->put($version, 'waveform', json_encode(['peaks' => $peaks], JSON_THROW_ON_ERROR));
				$this->mark($version->getId(), Job::KIND_WAVEFORM, self::STATE_READY);
			}
			return;
		}
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
	 * A still needs no ffprobe and no derived media: its size is all there is
	 * to know, and it is one Frame long, so every Comment anchors to Frame 0.
	 */
	private function measureImage(Version $version, string $path): void {
		$size = @getimagesize($path);
		$version->setWidth($size === false ? 0 : $size[0]);
		$version->setHeight($size === false ? 0 : $size[1]);
		$version->setDurationFrames(1);
		$version->setHasVideo(false);
		$version->setHasAudio(false);
		$version->setPlayable(true);
		$this->versions->update($version);
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
	 * A Waveform and duration the browser worked out by decoding the file,
	 * where the server has no ffmpeg to do it. Only taken when there is no
	 * Waveform and nothing on its way: a browser never overrides the server.
	 *
	 * @param list<mixed> $peaks
	 * @throws InvalidRequestException peaks or duration out of shape
	 * @throws ProjectConflictException the Version has a Waveform or is getting one
	 */
	public function acceptWaveform(Version $version, array $peaks, int $durationFrames): void {
		if ($peaks === [] || count($peaks) > self::WAVEFORM_BUCKETS || $durationFrames < 1) {
			throw new InvalidRequestException('A Waveform is 1 to ' . self::WAVEFORM_BUCKETS . ' peaks over a duration of at least one Frame');
		}
		foreach ($peaks as $peak) {
			if (!is_int($peak) && !is_float($peak) || $peak < 0 || $peak > 1) {
				throw new InvalidRequestException('Peaks run from 0 to 1');
			}
		}
		if (!$version->getHasAudio() || $version->getWaveformState() !== self::STATE_NONE) {
			throw new ProjectConflictException('This Version has its Waveform from the server');
		}
		$this->put($version, 'waveform', json_encode(['peaks' => array_map(static fn ($peak) => round((float)$peak, 3), $peaks)], JSON_THROW_ON_ERROR));
		if ($version->getDurationFrames() === null) {
			$version->setDurationFrames($durationFrames);
		}
		$version->setWaveformState(self::STATE_READY);
		$this->versions->update($version);
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
			isset(self::PLAYABLE[$format]) => $format,
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
		$this->jobs->deleteBy('version_id', $versionId);
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
		$node = $this->root->getFirstNodeById($version->getFileId());
		return $node instanceof File ? $node : null;
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
