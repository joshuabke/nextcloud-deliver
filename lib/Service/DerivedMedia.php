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
		// The Thumbnail Strip of a Safari, which draws no WebP; `thumbs` is served from here where there is no WebP
		'thumbsJpeg' => 'thumbs.jpg',
		'thumbsIndex' => 'thumbs.json',
		'waveform' => 'waveform.json',
	];

	/** Codecs a browser plays in each container family, by their ffprobe names */
	private const PLAYABLE = [
		'mp4' => ['video' => ['h264'], 'audio' => ['aac', 'mp3']],
		// AV1 plays only on recent Apple hardware, so it gets a Proxy (ADR 0019)
		'webm' => ['video' => ['vp8', 'vp9'], 'audio' => ['opus', 'vorbis']],
		// Audio files: a picture in them is cover art at most, and anything else is no audio file
		'mp3' => ['video' => [], 'audio' => ['mp3']],
		'aac' => ['video' => [], 'audio' => ['aac']],
		'flac' => ['video' => [], 'audio' => ['flac']],
		'ogg' => ['video' => [], 'audio' => ['vorbis', 'opus', 'flac']],
		'wav' => ['video' => [], 'audio' => ['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le']],
		// Only read without ffmpeg (ffprobe says matroska,webm): Chrome and Firefox play these, Safari tells its user to switch
		'matroska' => ['video' => ['h264', 'vp8', 'vp9'], 'audio' => ['aac', 'opus', 'vorbis', 'flac', 'mp3']],
	];

	private const THUMB_WIDTH = 160;
	/** A Thumbnail Strip from the browser, at most */
	private const MAX_THUMBS_BYTES = 32 * 1024 * 1024;
	/** Whether the server lacks ffmpeg, as proxyFromBrowser found once for this request */
	private ?bool $withoutFfmpegNow = null;
	/** The Proxy's AAC, which counts towards the Proxy bitrate threshold with the picture */
	private const AUDIO_KBPS = 160;
	private const WAVEFORM_BUCKETS = 2000;
	/** Seconds between two progress writes to the job row */
	private const PROGRESS_INTERVAL = 2;

	/** Who works on a Proxy that the uploading browser makes (ADR 0019) */
	public const BROWSER = 'browser';
	/** Seconds after the last report of a browser making a Proxy, when its tab counts as closed */
	public const BROWSER_LAPSE = 120;

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

	/**
	 * A file written again in place is read again as on intake: what the probe
	 * said and all its derived media go, also a Waveform handed in for the old
	 * content (spec: Delivering again)
	 */
	public function reread(Version $version): void {
		$version->setFpsNum(null);
		$version->setFpsDen(null);
		$version->setDropFrame(false);
		$version->setStartFrame(null);
		$version->setDurationFrames(null);
		$version->setWidth(null);
		$version->setHeight(null);
		$version->setHasVideo(false);
		$version->setHasAudio(false);
		$version->setPlayable(null);
		$this->versions->update($version);
		$this->forget($version->getId());
		$this->queue($version->getId());
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
			$this->guard();
			$this->mark($version->getId(), $job->getKind(), self::STATE_READY);
			$this->jobs->delete($job);
		} catch (\Throwable $e) {
			if ($this->withdrawn($job)) {
				return;
			}
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

	/**
	 * Whether the job was taken back while it ran: writing its file again
	 * (reread) or regenerating deletes the Version's jobs, and what
	 * a job found in the old content must not land over what came since
	 */
	private function withdrawn(Job $job): bool {
		return $this->jobs->find($job->getId()) === null;
	}

	/** @throws \RuntimeException before the running job writes anything, when it has been withdrawn */
	private function guard(): void {
		if ($this->running !== null && $this->withdrawn($this->running['job'])) {
			throw new \RuntimeException('Withdrawn while running');
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
		$this->guard();
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
		if ($this->needsProxy($version, $probed, $path)) {
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
		$this->guard();
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
			$this->store($version, 'proxy', function (string $output) use ($version, $path, $encoder): void {
				$this->ffmpeg($this->proxyArgs($version, $path, $encoder, $output));
				// A hardware encoder may know only a constant quality and ignore the ceiling
				if ($encoder !== Encoder::NONE && $this->heavy((int)filesize($output), $this->durationSeconds($version))) {
					throw new \RuntimeException('The hardware encoder went above the Proxy bitrate threshold');
				}
			});
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
		// A keyframe every second, so seeking stays quick; a tenth below the threshold leaves room for the encoder's overshoot
		$args = $this->encoder->args($encoder, $this->maxHeight(), $num && $den ? (int)round($num / $den) : 25, (int)($this->maxBitrate() * 900) - self::AUDIO_KBPS);
		return [
			...$args['input'],
			...Ffmpeg::input($path),
			'-map', '0:v:0', '-map', '0:a:0?',
			'-vf', $args['filter'],
			...($num && $den ? ['-r', "$num/$den"] : []),
			...$args['codec'],
			'-c:a', 'aac', '-b:a', self::AUDIO_KBPS . 'k',
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
		$cap = $this->thumbCap();
		$duration = $this->durationSeconds($version);
		$every = max(1, (int)ceil($duration / $cap));
		$count = max(1, min($cap, (int)ceil($duration / $every)));
		[$columns, $rows] = self::grid($count);

		$this->store($version, 'thumbs', fn (string $output) => $this->ffmpeg([
			...Ffmpeg::input($path),
			'-vf', "fps=1/$every,scale=" . self::THUMB_WIDTH . ":-2,tile={$columns}x{$rows}",
			'-frames:v', '1',
			'-f', 'webp', $output,
		]));
		$this->putThumbsIndex($version, $every, $count);
	}

	/** @return array{int, int} the columns and rows of a near square grid of so many pictures */
	private static function grid(int $count): array {
		$columns = (int)ceil(sqrt($count));
		return [$columns, (int)ceil($count / $columns)];
	}

	private function putThumbsIndex(Version $version, int $every, int $count): void {
		[$columns, $rows] = self::grid($count);
		$this->put($version, 'thumbsIndex', json_encode([
			'every' => $every,
			'count' => $count,
			'columns' => $columns,
			'rows' => $rows,
			'width' => self::THUMB_WIDTH,
			'fps' => ['num' => $version->getFpsNum(), 'den' => $version->getFpsDen()],
		], JSON_THROW_ON_ERROR));
	}

	/**
	 * A Thumbnail Strip the browser made in the same pass as a Proxy (ADR
	 * 0019): a WebP grid in the shape runThumbs makes (a JPEG one from a
	 * browser that encodes no WebP), a picture every so many seconds, each 160
	 * wide. The browser measured the length itself, so
	 * its spacing and count may be one off the server's. Only taken while the
	 * Version has none and none is on its way: a server-made one wins, and
	 * replaces it on regeneration.
	 *
	 * @throws InvalidRequestException the image or its grid is out of shape
	 * @throws ProjectConflictException the Version has no picture, is not read yet, or has its Thumbnail Strip or is getting one
	 */
	public function acceptThumbs(Version $version, string $image, int $every, int $count): void {
		if (!$version->getHasVideo() || $version->getPlayable() === null || $version->getThumbsState() !== self::STATE_NONE) {
			throw new ProjectConflictException('This Version takes no Thumbnail Strip from the browser');
		}
		$duration = $this->durationSeconds($version);
		$cap = $this->thumbCap();
		$expected = max(1, (int)ceil($duration / $cap));
		if ($count < 1 || $count > $cap || $every < 1 || abs($every - $expected) > 1 || abs($count - (int)ceil($duration / $every)) > 1) {
			throw new InvalidRequestException('A picture every ' . $expected . ' seconds, at most ' . $cap);
		}
		[$columns, $rows] = self::grid($count);
		$size = strlen($image) <= self::MAX_THUMBS_BYTES ? getimagesizefromstring($image) : false;
		$tile = $size === false ? 0 : intdiv($size[1], $rows);
		// Portrait as high as four widths at most, as a phone's 9:16 is not even two
		if ($size === false || !in_array($size[2], [IMAGETYPE_WEBP, IMAGETYPE_JPEG], true) || $size[0] !== $columns * self::THUMB_WIDTH
			|| $tile * $rows !== $size[1] || $tile < 2 || $tile % 2 !== 0 || $tile > 4 * self::THUMB_WIDTH) {
			throw new InvalidRequestException('A Thumbnail Strip is a WebP or JPEG of ' . $columns . ' by ' . $rows . ' pictures, each ' . self::THUMB_WIDTH . ' wide and of even height');
		}
		$this->put($version, $size[2] === IMAGETYPE_JPEG ? 'thumbsJpeg' : 'thumbs', $image);
		$this->putThumbsIndex($version, $every, $count);
		$this->mark($version->getId(), Job::KIND_THUMBS, self::STATE_READY);
	}

	/** The Thumbnail Strip cap, which browsers keep to as well */
	public function thumbCap(): int {
		return max(1, $this->config->getValueInt(Application::APP_ID, 'thumb_cap', 600));
	}

	/** Mono 8 kHz PCM from ffmpeg, reduced to peaks without another binary */
	private function runWaveform(Version $version, string $path): void {
		$pcm = tempnam(sys_get_temp_dir(), 'deliver-') ?: throw new \RuntimeException('No temporary file for the Waveform');
		try {
			$this->ffmpeg([
				...Ffmpeg::input($path),
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
	 * where the server has no ffmpeg to do it, or the delivering tool had
	 * anyway (ADR 0012). Only taken when there is no Waveform and nothing on
	 * its way: neither ever overrides the server, while a Waveform the server
	 * makes later (ffmpeg's, a WAV's PCM) replaces theirs. The duration counts
	 * Frames of the Version, for audio milliseconds also before the probe.
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
		// Also before the probe ran (playable is still unknown then), so a delivering tool can hand in its peaks with the upload
		if (!$version->getHasAudio() && $version->getPlayable() !== null || $version->getWaveformState() !== self::STATE_NONE) {
			throw new ProjectConflictException('This Version has its Waveform from the server');
		}
		$this->put($version, 'waveform', json_encode(['peaks' => array_map(static fn ($peak) => round((float)$peak, 3), $peaks)], JSON_THROW_ON_ERROR));
		if ($version->getDurationFrames() === null) {
			$version->setDurationFrames($durationFrames);
		}
		$version->setWaveformState(self::STATE_READY);
		$this->versions->update($version);
	}

	/** Whether the server lacks ffmpeg, so browsers make Waveforms and Proxies (ADRs 0012, 0019); ffmpeg may have come since the last look */
	public function withoutFfmpeg(): bool {
		return !$this->ffmpeg->available() && $this->ffmpeg->probe() === null;
	}

	/**
	 * How far the uploading browser has got with a Proxy (ADR 0019). Its
	 * report keeps a running job of its own on the Version, so everyone sees
	 * the progress; a browser that stops reporting has gone (lapse).
	 *
	 * @throws ProjectConflictException the server makes Proxies, or the Version has one
	 */
	public function proxyProgress(Version $version, int $percent): void {
		$this->assertBrowserProxy($version);
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROXY);
		if ($job === null) {
			$job = new Job();
			$job->setKind(Job::KIND_PROXY);
			$job->setVersionId($version->getId());
			$job->setState(Job::STATE_RUNNING);
			$job->setClaimedBy(self::BROWSER);
			$job->setCreatedAt($this->time->getTime());
			$job = $this->jobs->insert($job);
		} elseif ($job->getClaimedBy() !== self::BROWSER) {
			throw new ProjectConflictException('The server makes this Proxy');
		}
		$job->setProgress(max(0, min(99, $percent)));
		$job->setStartedAt($this->time->getTime());
		$this->jobs->update($job);
		$version->setProxyState(self::STATE_RUNNING);
		$version->setDerivedError(null);
		$this->versions->update($version);
	}

	/**
	 * Whether a browser is to make the Proxy of this Version (ADR 0019): the
	 * server has no ffmpeg, and the Version, once read, needs a Proxy and has
	 * none, also after one failed. Without ffmpeg the probe stops before it
	 * would queue one, so this is where the rule is applied.
	 *
	 * @param int $bytes the size of the Version's file, for the Proxy bitrate threshold
	 */
	public function proxyFromBrowser(Version $version, int $bytes): bool {
		return $version->getHasVideo() && $version->getPlayable() !== null
			&& in_array($version->getProxyState(), [self::STATE_NONE, self::STATE_FAILED], true)
			&& (!$version->getPlayable() || $this->heavy($bytes, $this->durationSeconds($version)))
			// Once per request: a Project read asks for each of its Versions, and each look at ffmpeg starts a process
			&& ($this->withoutFfmpegNow ??= $this->withoutFfmpeg());
	}

	/** A browser that has not reported for a while closed its tab: its Proxy counts as missing again (spec: Proxies from the browser) */
	public function lapse(Version $version): void {
		if ($version->getProxyState() !== self::STATE_RUNNING) {
			return;
		}
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROXY);
		if ($job?->getClaimedBy() === self::BROWSER && $job->getStartedAt() < $this->time->getTime() - self::BROWSER_LAPSE) {
			$this->jobs->delete($job);
			$version->setProxyState(self::STATE_NONE);
			$this->versions->update($version);
		}
	}

	/**
	 * Takes the Proxy the uploading browser made (ADR 0019) after checking it
	 * as the browser did: H.264/AAC MP4 that browsers play, within the Proxy
	 * resolution, with as many Frames as the original at its rate, so that
	 * every Frame anchor holds. A Proxy that does not match is refused, and
	 * the Version shows that its Proxy failed.
	 *
	 * @throws ProjectConflictException the server makes Proxies, the Version needs none, has one, or is not read yet
	 * @throws InvalidRequestException the upload is no Proxy of this Version
	 */
	public function acceptProxy(Version $version, File $original, File $upload): void {
		$this->assertBrowserProxy($version);
		$source = $this->probe->localPath($original);
		$candidate = $this->probe->localPath($upload);
		if ($source === null || $candidate === null) {
			throw new \RuntimeException('The files are not readable');
		}
		// The upload may be quicker than the background job that reads the original
		if ($version->getPlayable() === null) {
			$job = $this->jobs->findPending($version->getId(), Job::KIND_PROBE);
			// Claimed as by any worker: should the request die, the probe is queued again like theirs
			if ($job !== null && $this->jobs->claim($job, 'request', $this->time->getTime())) {
				$this->process($job);
			}
			$version = $this->versions->find($version->getId()) ?? throw new \RuntimeException('The Version is gone');
			if ($version->getPlayable() === null) {
				throw new ProjectConflictException('The original is not read yet');
			}
		}
		$probed = $this->container->read($source) ?? [];
		if (!$this->needsProxy($version, $probed, $source)) {
			throw new ProjectConflictException('This Version plays without a Proxy');
		}
		$error = $this->mismatch($version, $probed, $this->container->read($candidate));
		if ($error === null) {
			$stream = $upload->fopen('r');
			try {
				$this->put($version, 'proxy', $stream);
			} finally {
				if (is_resource($stream)) {
					fclose($stream);
				}
			}
		}
		// Only now: should storing fail, the browser's job lapses and the Proxy counts as missing again
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROXY);
		if ($job !== null) {
			$this->jobs->delete($job);
		}
		$this->mark($version->getId(), Job::KIND_PROXY, $error === null ? self::STATE_READY : self::STATE_FAILED, $error);
		if ($error !== null) {
			throw new InvalidRequestException($error);
		}
	}

	/** @throws ProjectConflictException the server makes Proxies, or the Version has one */
	private function assertBrowserProxy(Version $version): void {
		if (!$this->withoutFfmpeg()) {
			throw new ProjectConflictException('This server makes Proxies with ffmpeg');
		}
		if ($version->getProxyState() === self::STATE_READY) {
			throw new ProjectConflictException('This Version has its Proxy');
		}
	}

	/**
	 * @param array<string, mixed> $original what the original's headers say
	 * @param ?array<string, mixed> $proxy what the Proxy's headers say
	 * @return ?string why the Proxy does not fit the Version, null when it does
	 */
	private function mismatch(Version $version, array $original, ?array $proxy): ?string {
		$picture = $this->videoOf($proxy);
		if ($proxy === null || $picture === null || !str_contains((string)($proxy['format']['format_name'] ?? ''), 'mp4') || !$this->browserPlays($proxy)) {
			return 'The Proxy is no H.264/AAC MP4 that browsers play';
		}
		if (min((int)($picture['width'] ?? 0), (int)($picture['height'] ?? 0)) > $this->maxHeight()) {
			return 'The Proxy is larger than the Proxy resolution';
		}
		if ($version->getHasAudio() && !array_filter($this->probe->streams($proxy), static fn (array $stream) => ($stream['codec_type'] ?? '') === 'audio')) {
			return 'The Proxy has no sound, the original has';
		}
		$num = (int)$version->getFpsNum();
		$den = (int)$version->getFpsDen();
		$made = (int)($picture['nb_frames'] ?? -1);
		$frames = $this->videoOf($original)['nb_frames'] ?? null;
		if ($num < 1 || $den < 1 || $frames !== null && $made !== (int)$frames) {
			return "The Proxy has other Frames than the original's $frames";
		}
		// WebM and MKV do not count their Frames, and their length includes the sound, which may run on a little
		if ($frames === null && abs($made - (int)$version->getDurationFrames()) > max(1, (int)round($num / $den / 5))) {
			return 'The Proxy has other Frames than the original\'s ' . (int)$version->getDurationFrames();
		}
		// Within half a Frame over the whole length, so the rate cannot drift a Frame anywhere
		if (abs((float)($picture['duration'] ?? 0) - $made * $den / $num) > $den / $num / 2) {
			return 'The Proxy runs at another frame rate than the original';
		}
		return null;
	}

	/**
	 * @param ?array<string, mixed> $probed
	 * @return ?array<string, mixed> the first video stream
	 */
	private function videoOf(?array $probed): ?array {
		foreach ($probed === null ? [] : $this->probe->streams($probed) as $stream) {
			if (($stream['codec_type'] ?? '') === 'video') {
				return $stream;
			}
		}
		return null;
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

	/**
	 * Whether a Version gets a Proxy: browsers do not play its original, or
	 * it is heavier than the Proxy bitrate threshold, so that slow connections
	 * get a lighter choice (ADR 0019).
	 */
	private function needsProxy(Version $version, array $probed, string $path): bool {
		return $version->getHasVideo()
			&& (!$version->getPlayable() || $this->heavy((int)filesize($path), (float)($probed['format']['duration'] ?? 0)));
	}

	/** Whether a file of this size and length goes above the Proxy bitrate threshold */
	private function heavy(int $bytes, float $seconds): bool {
		return $seconds > 0 && $bytes * 8 / $seconds > $this->maxBitrate() * 1_000_000;
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
		$this->guard();
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
		$folder = $this->appDataFactory->get(Application::APP_ID)->getFolder((string)$version->getId());
		try {
			return $folder->getFile(self::FILES[$kind]);
		} catch (NotFoundException $e) {
			// A server-made WebP wins, so the JPEG from a browser is only the fallback
			if ($kind !== 'thumbs') {
				throw $e;
			}
			return $folder->getFile(self::FILES['thumbsJpeg']);
		}
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

	/** The Proxy bitrate threshold in Mbit/s: what goes above it gets a Proxy, and no Proxy goes above it */
	public function maxBitrate(): int {
		return max(PipelineSettings::MIN_BITRATE, $this->config->getValueInt(Application::APP_ID, 'max_bitrate', PipelineSettings::BITRATE));
	}

	public function maxHeight(): int {
		return max(PipelineSettings::MIN_HEIGHT, $this->config->getValueInt(Application::APP_ID, 'max_height', 1080));
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
