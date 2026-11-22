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
 * Proxies, Thumbnail Strips, Waveforms and Scrub Proxies (ADR 0003). They live in app data,
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
		'scrub' => 'scrub.mp4',
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

	/** The Thumbnail Strip of a Safari, which draws no WebP; `thumbs` is served from here where there is no WebP */
	private const THUMBS_JPEG = 'thumbs.jpg';
	private const THUMB_WIDTH = 160;
	/** A Thumbnail Strip from the browser, at most */
	private const MAX_THUMBS_BYTES = 32 * 1024 * 1024;
	/** Whether the server lacks ffmpeg, found once per request: each look starts a process */
	private ?bool $withoutFfmpegNow = null;
	/** The Proxy's AAC, which counts towards the Proxy bitrate threshold with the picture */
	private const AUDIO_KBPS = 160;
	/**
	 * A Waveform's peaks a second (ADR 0021): 50, so 15 seconds still draw a
	 * wave across a wide screen, fewer only where a file is so long that it
	 * would go past WAVEFORM_MAX_PEAKS (past 11 hours)
	 */
	public const WAVEFORM_RATE = 50;
	public const WAVEFORM_MAX_PEAKS = 2_000_000;
	/**
	 * ffmpeg's PCM for the Waveform: 16 kHz, so sound up to 8 kHz counts (a
	 * hi-hat, a 6 kHz tone), in every channel of the file, as any mix would
	 * lose sound on one side, two sides out of phase or 3 dB of mono
	 */
	private const WAVEFORM_PCM_RATE = 16000;
	/**
	 * Audio up to this long and this large, at no more bytes a second than
	 * 192 kHz 32-bit stereo PCM, is read and gets its Waveform in the request
	 * that takes it in: ffmpeg needs about 3 seconds an hour of MP3, while the
	 * queue may wait for the next cron run and for Proxies before it
	 */
	private const AUDIO_NOW_SECONDS = 1800;
	private const AUDIO_NOW_BYTES = 256 * 1024 * 1024;
	private const AUDIO_NOW_BYTES_PER_SECOND = 192000 * 4 * 2;
	/** How long ffmpeg may take for a Waveform in a request before the queue takes it over */
	private const AUDIO_NOW_TIMEOUT = 15;
	/** The exception code of a Waveform a request leaves to the queue */
	private const TO_QUEUE = 124;
	/** App config: the time from which Waveforms are made while idle again (pauseIdleWaveforms) */
	private const IDLE_WAVEFORMS_AFTER = 'idle_waveforms_after';
	/** App config: the Version below which the idle look goes on, past one whose file was not there */
	private const IDLE_WAVEFORMS_BELOW = 'idle_waveforms_below';
	/** Versions the idle look steps past at most, before it leaves the rest to the next run */
	private const IDLE_LOOK = 20;
	private const IDLE_PAUSE = 3600;
	/**
	 * Whether this request has read an audio file already: a request may bring
	 * many (a sync client's bulk upload, an app unpacking an archive), and
	 * reads only the first, so it stays within its seconds; the rest is the
	 * queue's. Per PHP process, which is one request.
	 */
	private static bool $requestRead = false;
	/** Integrated loudness in LUFS and true peak in dBTP that are shown at all, from ffmpeg or handed in (A5); the source of truth, which the browser's meter (src/lib/loudness.js) keeps as well */
	// Sanity bounds, not properties of programme material: BS.1770 adds the channel powers, so full-scale multichannel signal reads well above full scale, but no real file reaches +15 LUFS; real material peaks below about +6 dBTP even with inter-sample overs and float files
	private const LOUDNESS_RANGE = [-70.0, 15.0];
	private const PEAK_RANGE = [-200.0, 12.0];
	/** A WAV's loudness from the browser that uploaded it, beside its Waveform until the server's reader has made that (A9) */
	private const WAV_LOUDNESS = 'loudness.json';
	/** Set while the queue makes a Waveform because it had nothing else to do: such a Waveform gets no loudness (A5) */
	private bool $idle = false;
	/** Set while a request makes a Waveform itself: ffmpeg then has a short time and reads no further than the length its header says */
	private bool $inRequest = false;
	/** Seconds between two progress writes to the job row */
	private const PROGRESS_INTERVAL = 2;

	/** Seconds after the last report of a browser making a Proxy, when its tab counts as closed */
	public const BROWSER_LAPSE = 120;

	/** The Scrub Proxy: this wide at most, about this many kbit/s, and never above the ceiling in bit/s (#169) */
	private const SCRUB_WIDTH = 320;
	private const SCRUB_KBPS = 250;
	private const SCRUB_CEILING = 500_000;

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
		private PipelineSettings $settings,
		private ITimeFactory $time,
		private LoggerInterface $logger,
		private NotificationService $notifications,
		private BrowserPassMail $browserPassMail,
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

	/**
	 * With ffmpeg, the one audio file a request brings (an upload in Files,
	 * a sync client, Deliver's upload, delivering again; never a folder taken
	 * in at once) is read and gets its Waveform in that request, so it is
	 * there when the upload is (ADR 0022). Only a file on local storage,
	 * unencrypted, of 1 byte to 256 MB, at most 30 minutes long and at no more
	 * bytes a second than 192 kHz 32-bit stereo PCM, each step in a few
	 * seconds and no further than its header says, and no more requests at
	 * once than `max_jobs`; anything else, and whatever runs out of time,
	 * goes on in the queue. The jobs are claimed as by any worker: should the
	 * request die, they are queued again (JobRunner). Nothing here fails the
	 * request that brought the file.
	 */
	public function readAudioNow(?Version $version): void {
		try {
			$this->takeAudioNow($version);
		} catch (\Throwable $e) {
			$this->logger->warning('Deliver left the audio of Version {version} to the queue', ['version' => $version?->getId(), 'exception' => $e]);
		}
	}

	private function takeAudioNow(?Version $version): void {
		$file = $version === null ? null : $this->fileOf($version);
		$bytes = $file?->getSize() ?? 0;
		// A file made empty and written after (Finder, Windows) is read when its content comes
		if ($version === null || $file === null || !str_starts_with($file->getMimeType(), 'audio/') || $bytes < 1 || $bytes > self::AUDIO_NOW_BYTES
			// Elsewhere ffmpeg reads a copy, made first at that storage's speed
			|| !$file->getStorage()->isLocal() || $file->isEncrypted()
			|| !$this->ffmpeg->available()
			// ponytail: count, then claim; two requests can overshoot by one at the same instant, as in JobRunner
			|| $this->jobs->countRunningInRequests() >= max(1, $this->config->getValueInt(Application::APP_ID, 'max_jobs', 1))) {
			return;
		}
		if (self::$requestRead) {
			return;
		}
		self::$requestRead = true;
		$versionId = $version->getId();
		foreach ([Job::KIND_PROBE, Job::KIND_WAVEFORM] as $kind) {
			$job = $this->jobs->findPending($versionId, $kind);
			$version = $this->versions->find($versionId);
			$seconds = $version === null ? INF : $this->durationSeconds($version, INF);
			if ($job === null || $kind === Job::KIND_WAVEFORM && ($seconds > self::AUDIO_NOW_SECONDS || $bytes > max(1, $seconds) * self::AUDIO_NOW_BYTES_PER_SECOND)
				|| !$this->jobs->claim($job, Job::REQUEST, $this->time->getTime())) {
				return;
			}
			$this->inRequest = true;
			try {
				$this->process($job);
			} finally {
				$this->inRequest = false;
			}
		}
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
		// A Proxy handed in keeps ffmpeg from making another until it is removed or dropped (ADR 0020)
		if ($kind === Job::KIND_PROXY && $this->versions->find($versionId)?->getProxyHandedIn()) {
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
	public function process(Job $job, bool $idle = false): void {
		$this->idle = $idle;
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
				Job::KIND_SCRUB => $this->runScrub($version, $path),
				Job::KIND_LOUDNESS => $this->runLoudness($version, $path),
				default => throw new \RuntimeException('Unknown job kind ' . $job->getKind()),
			};
			$this->guard();
			$this->mark($version->getId(), $job->getKind(), self::STATE_READY);
			$this->jobs->delete($job);
		} catch (\Throwable $e) {
			if ($this->withdrawn($job)) {
				return;
			}
			if ($this->inRequest && $e->getCode() === self::TO_QUEUE) {
				$this->jobs->requeue($job->getId());
				$this->mark($version->getId(), $job->getKind(), self::STATE_QUEUED);
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
		$probed = $this->probe->apply($version, $path, $this->inRequest ? self::AUDIO_NOW_TIMEOUT : 120);
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
			$waveform = $version->getHasAudio() ? $this->container->wavPeaks($path) : null;
			if ($waveform !== null) {
				$this->put($version, 'waveform', self::waveformJson($waveform[0], $waveform[1]));
				$this->mark($version->getId(), Job::KIND_WAVEFORM, self::STATE_READY);
				// The uploading browser may have measured its loudness before this ran (A9)
				$this->addWavLoudness($version);
			}
			// Without ffmpeg nothing queues the Proxy: a browser has to make it (ADR 0019)
			if ($this->needsProxy($version, (int)filesize($path))) {
				$this->askBrowserPass($version);
			}
			return;
		}
		if ($this->needsProxy($version, (int)filesize($path))) {
			$this->enqueue($version->getId(), Job::KIND_PROXY);
		}
		if ($version->getHasVideo()) {
			$this->enqueue($version->getId(), Job::KIND_THUMBS);
		}
		if ($version->getHasAudio()) {
			$this->enqueue($version->getId(), Job::KIND_WAVEFORM);
		}
		if ($version->getHasVideo()) {
			$this->enqueue($version->getId(), Job::KIND_SCRUB);
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
			// Withdrawn, for instance by a Proxy handed in meanwhile: no second go in software
			$this->guard();
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

	/**
	 * The Scrub Proxy (#169): every Frame of the picture at 320 wide, a
	 * keyframe a second and no sound, for hover previews. Always libx264: at
	 * this size the encode costs next to nothing beside the decode, and a
	 * hardware encoder's constant quality would not hold the bitrate.
	 */
	private function runScrub(Version $version, string $path): void {
		$num = $version->getFpsNum();
		$den = $version->getFpsDen();
		$gop = (string)max(1, $num && $den ? (int)round($num / $den) : 25);
		$this->store($version, 'scrub', fn (string $output) => $this->ffmpeg([
			...Ffmpeg::input($path),
			'-map', '0:v:0', '-an',
			'-vf', 'scale=\'min(' . self::SCRUB_WIDTH . ',trunc(iw/2)*2)\':-2',
			...($num && $den ? ['-r', "$num/$den"] : []),
			'-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
			'-b:v', self::SCRUB_KBPS . 'k', '-maxrate', (int)(self::SCRUB_KBPS * 1.6) . 'k', '-bufsize', (2 * self::SCRUB_KBPS) . 'k',
			'-g', $gop,
			'-movflags', '+faststart',
			'-f', 'mp4', $output,
		]));
	}

	/**
	 * A Scrub Proxy a browser made where the server has no ffmpeg (#169): an
	 * H.264 MP4 that browsers play, at most 320 wide, below 0.5 Mbit/s, with
	 * the Version's Frames as a Proxy has them. Sound is not needed. One that
	 * does not fit is refused and leaves the Version without one.
	 *
	 * @throws ProjectConflictException the server makes Scrub Proxies, or the Version has one, has no picture or is not read yet
	 * @throws InvalidRequestException the upload is no Scrub Proxy of this Version
	 */
	public function acceptScrub(Version $version, File $original, File $upload): void {
		if (!$this->withoutFfmpeg()) {
			throw new ProjectConflictException('This server makes Scrub Proxies with ffmpeg');
		}
		$version = $this->readNow($version);
		if (!$version->getHasVideo() || $version->getScrubState() === self::STATE_READY) {
			throw new ProjectConflictException('This Version takes no Scrub Proxy');
		}
		$source = $this->probe->localPath($original);
		$candidate = $this->probe->localPath($upload);
		if ($source === null || $candidate === null) {
			throw new \RuntimeException('The files are not readable');
		}
		$probed = $this->container->read($candidate);
		$picture = $this->videoOf($probed);
		if ($probed === null || $picture === null || !str_contains((string)($probed['format']['format_name'] ?? ''), 'mp4') || !$this->browserPlays($probed)) {
			throw new InvalidRequestException('The Scrub Proxy is no H.264 MP4 that browsers play');
		}
		if ((int)($picture['width'] ?? 0) > self::SCRUB_WIDTH) {
			throw new InvalidRequestException('The Scrub Proxy is wider than ' . self::SCRUB_WIDTH . ' pixels');
		}
		$seconds = (float)($picture['duration'] ?? 0);
		if ($seconds <= 0 || filesize($candidate) * 8 / $seconds >= self::SCRUB_CEILING) {
			throw new InvalidRequestException('The Scrub Proxy is not below ' . self::SCRUB_CEILING / 1_000_000 . ' Mbit/s');
		}
		$error = $this->otherFrames($version, $this->container->read($source) ?? [], $picture, 'Scrub Proxy');
		if ($error !== null) {
			throw new InvalidRequestException($error);
		}
		$stream = $upload->fopen('r');
		try {
			$this->put($version, 'scrub', $stream);
		} finally {
			if (is_resource($stream)) {
				fclose($stream);
			}
		}
		$this->mark($version->getId(), Job::KIND_SCRUB, self::STATE_READY);
	}

	/**
	 * With ffmpeg, queues a Scrub Proxy for a few video Versions made before
	 * there were any, the newest first, once the last few are done; they run
	 * after every other job and hold none up (JobMapper::findQueued,
	 * JobRunner::runNext). Without ffmpeg only new
	 * uploads get one, from the browser.
	 *
	 * @return int how many
	 */
	public function queueMissingScrubs(int $limit): int {
		if (!$this->ffmpeg->available() || $this->jobs->findQueued(1, Job::KIND_SCRUB) !== []) {
			return 0;
		}
		$missing = $this->versions->findWithoutScrub($limit);
		foreach ($missing as $version) {
			$this->enqueue($version->getId(), Job::KIND_SCRUB);
		}
		return count($missing);
	}

	/**
	 * The Waveform of one Version with sound that has none, such as one from
	 * before the fixed rate (ADR 0021), queued only while the queue is empty,
	 * so it never holds up other work: whoever works the queue takes them
	 * one by one whenever it has nothing else to do.
	 *
	 * @return ?Job the job, to claim; null when there is other work or none
	 */
	public function queueMissingWaveform(): ?Job {
		// Waits for all other work but the loudness (A5), which waits for this
		$next = $this->jobs->findQueued(1)[0] ?? null;
		if ($this->time->getTime() < $this->config->getValueInt(Application::APP_ID, self::IDLE_WAVEFORMS_AFTER) || $next !== null && $next->getKind() !== Job::KIND_LOUDNESS || !$this->ffmpeg->available()) {
			return null;
		}
		// A file that is not there fails no Version (its storage may be offline, and every other would fail the same): the look steps past it, at most this many a time, and goes on below it next time
		$below = $this->config->getValueInt(Application::APP_ID, self::IDLE_WAVEFORMS_BELOW);
		$missing = $this->versions->findWithoutWaveform(self::IDLE_LOOK, $below ?: null);
		foreach ($missing as $version) {
			$file = $this->fileOf($version);
			try {
				$there = $file !== null && $file->getStorage()->file_exists($file->getInternalPath());
			} catch (\Throwable) {
				$there = false;
			}
			if ($there) {
				$this->enqueue($version->getId(), Job::KIND_WAVEFORM);
				return $this->jobs->findPending($version->getId(), Job::KIND_WAVEFORM);
			}
			$this->config->setValueInt(Application::APP_ID, self::IDLE_WAVEFORMS_BELOW, $version->getId());
		}
		// Past the oldest: from the newest again next time, also those whose file was not there
		if (count($missing) < self::IDLE_LOOK && $this->config->hasKey(Application::APP_ID, self::IDLE_WAVEFORMS_BELOW)) {
			$this->config->deleteKey(Application::APP_ID, self::IDLE_WAVEFORMS_BELOW);
		}
		return null;
	}

	/**
	 * No Waveform is made while idle for an hour, across cron runs and
	 * workers: one that failed, or a file that is not there, may have a cause
	 * no Version has (storage offline), which would otherwise fail one old
	 * Version every cron run.
	 */
	public function pauseIdleWaveforms(): void {
		$this->config->setValueInt(Application::APP_ID, self::IDLE_WAVEFORMS_AFTER, $this->time->getTime() + self::IDLE_PAUSE);
	}

	/**
	 * A Version someone opens gets its missing Waveform queued ahead of those
	 * the queue makes when idle, so it shows in that visit (the Review view
	 * asks again while it is queued). Only with ffmpeg: without, the browser
	 * makes it.
	 */
	public function opened(Version $version): void {
		if ($version->getHasAudio() && $version->getWaveformState() === self::STATE_NONE && $version->getPlayable() !== null
			&& $version->getState() === Version::STATE_READY && $this->ffmpeg->available()) {
			$this->enqueue($version->getId(), Job::KIND_WAVEFORM);
			// What is shown next of this Version says so, and the view asks again until it is there
			$version->setWaveformState(self::STATE_QUEUED);
		}
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
	 * @throws ProjectConflictException the Version has no picture, cannot be read now, or has its Thumbnail Strip or is getting one
	 */
	public function acceptThumbs(Version $version, string $image, int $every, int $count): void {
		// Without a Proxy before it, a browser's pass may be quicker than the background job that reads the original (#168)
		$version = $this->readNow($version);
		if (!$version->getHasVideo() || $version->getThumbsState() !== self::STATE_NONE) {
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
		$this->put($version, 'thumbs', $image, $size[2] === IMAGETYPE_JPEG ? self::THUMBS_JPEG : null);
		$this->putThumbsIndex($version, $every, $count);
		$this->mark($version->getId(), Job::KIND_THUMBS, self::STATE_READY);
	}

	/** The Thumbnail Strip cap, which browsers keep to as well */
	private function thumbCap(): int {
		return $this->settings->proxy()['thumbCap'];
	}

	/** PCM from ffmpeg, reduced to peaks as it streams out, without another binary and without holding it */
	private function runWaveform(Version $version, string $path): void {
		$channels = 0;
		foreach ($this->probe->streams($this->probe->read($path, $this->inRequest ? self::AUDIO_NOW_TIMEOUT : 120) ?? []) as $stream) {
			if (($stream['codec_type'] ?? '') === 'audio') {
				$channels = (int)($stream['channels'] ?? 0);
				break;
			}
		}
		if ($channels < 1) {
			throw new \RuntimeException('ffprobe finds no sound to draw');
		}
		$rate = self::waveformRate($this->durationSeconds($version));
		$peaks = new PcmPeaks(self::WAVEFORM_PCM_RATE, $channels, $rate);
		$bytes = 0;
		// In a request no further than the header says, and a little: sound that runs on is the queue's
		$bound = $this->inRequest ? $this->durationSeconds($version) + 5 : null;
		$result = $this->ffmpeg->run($this->ffmpeg->ffmpeg(), [
			'-nostdin', '-v', 'error',
			...Ffmpeg::input($path),
			'-map', '0:a:0', '-ar', (string)self::WAVEFORM_PCM_RATE,
			...($bound === null ? [] : ['-t', (string)$bound]),
			'-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
		], $this->inRequest ? self::AUDIO_NOW_TIMEOUT : 3600, function (string $pcm) use ($peaks, $channels, &$bytes): bool {
			$bytes += strlen($pcm);
			$this->reached((int)($bytes / (2 * $channels * self::WAVEFORM_PCM_RATE) * 1e6));
			return $peaks->add($pcm);
		});
		if ($bound !== null && ($result['code'] === 124 || $bytes >= ($bound - 1) * 2 * $channels * self::WAVEFORM_PCM_RATE)) {
			throw new \RuntimeException('Left to the queue: more than a request may take', self::TO_QUEUE);
		}
		// A track without a sample is a Waveform without a peak, as silent as it is, not a failure
		if ($result['code'] !== 0) {
			throw new \RuntimeException($result['stderr'] ?: 'ffmpeg exited with ' . $result['code']);
		}
		$this->put($version, 'waveform', self::waveformJson($rate, $peaks->peaks()));
		// Measuring the loudness would cost the Waveform five times its time, so it follows, last in the queue (A5); not for the old Waveforms made while idle, which are no reason to read every file again
		if (!$this->idle) {
			$this->enqueue($version->getId(), Job::KIND_LOUDNESS);
		}
	}

	/**
	 * The loudness of a Version with a Waveform from ffmpeg (A5): integrated
	 * loudness and true peak by ffmpeg's ebur128 at the original rate over
	 * every channel (it weights the surrounds of 5.1 and 7.1 and leaves out
	 * the LFE), written into the Waveform's JSON, which takes its name only
	 * once whole. A run stopped early prints no summary and gives no numbers.
	 */
	private function runLoudness(Version $version, string $path): void {
		$result = $this->ffmpeg->run($this->ffmpeg->ffmpeg(), [
			// The summary comes at the info level; frame lines only at verbose, so ffmpeg 4.4 and 5.1, which know no framelog=quiet, print none either
			'-nostdin', '-nostats', '-hide_banner', '-v', 'info', '-progress', 'pipe:1',
			...Ffmpeg::input($path),
			'-map', '0:a:0', '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-',
		], 3600, fn (string $chunk) => $this->progressed($chunk));
		$loudness = $result['code'] === 0 ? self::loudnessOf($result['stderr']) : null;
		try {
			$waveform = json_decode($this->file($version, 'waveform')->getContent(), true, 4, JSON_THROW_ON_ERROR);
		} catch (NotFoundException|\JsonException) {
			$waveform = null;
		}
		// No numbers is no failure of anything a Member or the admin can act on: the Waveform shows none
		if ($loudness === null || !is_array($waveform)) {
			// A warning, so a cause that meets every file (an ffmpeg without ebur128, a summary worded otherwise) shows in the log; no failed job, as nothing can be done about one file
			$this->logger->warning('Deliver measured no loudness for Version {version}: {stderr}', ['version' => $version->getId(), 'stderr' => $this->ffmpeg->tail($result['stderr'])]);
			return;
		}
		// ebur128 says 0.0 dBFS for a track without a sample, which has no peak
		if (($waveform['peaks'] ?? '') === '') {
			$loudness['peak'] = null;
		}
		$this->put($version, 'waveform', json_encode(['loudness' => $loudness] + $waveform, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION));
	}

	/**
	 * The loudness a browser or a delivering tool hands in with a Waveform:
	 * optional, else integrated LUFS from −70 to +15 and a true peak from −200 to
	 * +12 dBTP, each a number or null, and no other key
	 *
	 * @return ?array{integrated: ?float, peak: ?float}
	 * @throws InvalidRequestException out of shape
	 */
	private static function handedLoudness(mixed $loudness): ?array {
		if ($loudness === null) {
			return null;
		}
		$within = static fn (mixed $value, float $low, float $high): bool => $value === null || (is_int($value) || is_float($value)) && is_finite((float)$value) && $value >= $low && $value <= $high;
		// Only these two keys, both there: a peak is a true peak in dBTP, never a sample peak
		if (!is_array($loudness) || array_diff(array_keys($loudness), ['integrated', 'peak']) !== [] || !array_key_exists('integrated', $loudness) || !array_key_exists('peak', $loudness)
			|| !$within($loudness['integrated'], ...self::LOUDNESS_RANGE) || !$within($loudness['peak'], ...self::PEAK_RANGE)) {
			throw new InvalidRequestException('Loudness is {integrated: LUFS from -70 to 15 or null, peak: true peak in dBTP from -200 to 12 or null}, with both and nothing else');
		}
		$round = static fn (mixed $value): ?float => $value === null ? null : round((float)$value, 1);
		return ['integrated' => $round($loudness['integrated']), 'peak' => $round($loudness['peak'])];
	}

	/**
	 * The integrated loudness and true peak from the summary ffmpeg's ebur128
	 * prints at its end (A5)
	 *
	 * @return ?array{integrated: ?float, peak: ?float} null without a summary or where a number lies past its range; integrated null below the absolute gate (silence), peak null without a sample
	 */
	public static function loudnessOf(string $stderr): ?array {
		$number = '(-?inf|nan|-?\d+(?:[.,]\d+)?)';
		// From the summary on: before it, ffmpeg prints the file's own tags, which may say anything
		$at = strrpos($stderr, 'Summary:');
		$summary = $at === false ? '' : substr($stderr, $at);
		if (preg_match('/Integrated loudness:\s*I:\s*' . $number . '\s*LUFS/', $summary, $integrated) !== 1
			|| preg_match('/True peak:\s*Peak:\s*' . $number . '\s*dBFS/', $summary, $peak) !== 1) {
			return null;
		}
		$value = static fn (string $text): ?float => is_numeric($text = str_replace(',', '.', $text)) ? round((float)$text, 1) : null;
		$lufs = $value($integrated[1]);
		$dB = $value($peak[1]);
		// One number past the ranges a hand-in is held to means the decode was broken: none of the measurement is shown
		if ($lufs !== null && $lufs > self::LOUDNESS_RANGE[1] || $dB !== null && ($dB < self::PEAK_RANGE[0] || $dB > self::PEAK_RANGE[1])) {
			return null;
		}
		return [
			// ebur128 says −70.0 where every block lies below the absolute gate: no value
			'integrated' => $lufs === null || $lufs <= self::LOUDNESS_RANGE[0] ? null : $lufs,
			'peak' => $dB,
		];
	}

	/** The peaks a second of a Waveform of this many seconds (ADR 0021) */
	public static function waveformRate(float $seconds): int {
		return max(1, min(self::WAVEFORM_RATE, intdiv(self::WAVEFORM_MAX_PEAKS, max(1, (int)ceil($seconds)))));
	}

	/** One peak from 0 to 1 as the byte the Waveform stores, 255 for full scale */
	public static function peakByte(float $peak): string {
		return chr((int)round(max(0, min(1, $peak)) * 255));
	}

	/**
	 * The stored Waveform: peak i is the loudest sample from i / rate to
	 * (i + 1) / rate seconds into the file, one byte each, in base64 (ADR 0021)
	 */
	private static function waveformJson(int $rate, string $peaks, ?array $loudness = null): string {
		return json_encode(['rate' => $rate, 'peaks' => base64_encode($peaks)] + ($loudness === null ? [] : ['loudness' => $loudness]), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
	}

	/** Whether the file of a Version is a WAV by its name, whose Waveform the server reads from its PCM without ffmpeg */
	public static function isWav(Version $version): bool {
		return in_array(strtolower(pathinfo($version->getName(), PATHINFO_EXTENSION)), ['wav', 'bwf'], true);
	}

	/**
	 * Whether the browser that uploads a WAV is to measure its loudness (A9):
	 * without ffmpeg the server reads a WAV's peaks from its PCM, but nobody
	 * its loudness, and it has none yet
	 */
	public function wavLoudnessFromBrowser(Version $version): bool {
		return self::isWav($version) && $this->withoutFfmpeg() && !$this->hasLoudness($version);
	}

	/**
	 * The loudness the browser that uploaded a WAV measured from the file it
	 * holds (A9), handed in alone: an addition to the Waveform the server
	 * reads from the PCM, which wins (ADR 0012). Kept beside it until that is
	 * made, then written into it as the loudness job writes its numbers.
	 *
	 * @throws InvalidRequestException the loudness is out of shape
	 * @param ?string $etag the ETag of the content the browser measured, as its upload came back with it
	 * @throws ProjectConflictException the server has ffmpeg, the file is no WAV or changed since, or the Version has its loudness
	 */
	public function acceptWavLoudness(Version $version, mixed $loudness, ?string $etag): Version {
		$loudness = self::handedLoudness($loudness) ?? throw new InvalidRequestException('Loudness alone is a loudness and nothing else');
		if ($etag === null || $etag === '') {
			throw new InvalidRequestException('Loudness alone names the ETag of the content it was measured from');
		}
		$this->assertContent($version, $etag);
		if (!$this->withoutFfmpeg()) {
			throw new ProjectConflictException('This server measures loudness with ffmpeg');
		}
		if (!self::isWav($version)) {
			throw new ProjectConflictException('Only the loudness of a WAV is handed in alone');
		}
		if ($this->hasLoudness($version)) {
			throw new ProjectConflictException('This Version has its loudness');
		}
		$this->put($version, 'waveform', json_encode($loudness, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), self::WAV_LOUDNESS);
		$this->addWavLoudness($version);
		return $version;
	}

	/**
	 * What a browser measured is bound to the content it measured: a file
	 * written again since, by anyone, has numbers of another mix, so they are
	 * refused (the rewrite dropped what was stored, as it always does)
	 *
	 * @param string $etag the ETag the upload of that content came back with
	 * @throws ProjectConflictException the file changed since
	 */
	private function assertContent(Version $version, string $etag): void {
		if (trim($etag, '"') !== $this->fileOf($version)?->getEtag()) {
			throw new ProjectConflictException('The file changed since it was measured');
		}
	}

	/** Whether a Version has loudness, in its Waveform or waiting beside it */
	private function hasLoudness(Version $version): bool {
		return $this->appDataJson($version, self::WAV_LOUDNESS) !== null || is_array($this->appDataJson($version, self::FILES['waveform'])['loudness'] ?? null);
	}

	/** Writes a WAV's loudness from the browser into its Waveform, once both are there */
	private function addWavLoudness(Version $version): void {
		$loudness = $this->appDataJson($version, self::WAV_LOUDNESS);
		$waveform = $this->appDataJson($version, self::FILES['waveform']);
		if ($loudness !== null && $waveform !== null && !isset($waveform['loudness'])) {
			$this->put($version, 'waveform', json_encode(['loudness' => $loudness] + $waveform, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION));
		}
	}

	/** @return ?array<string, mixed> a JSON file of the Version's app data, null where there is none */
	private function appDataJson(Version $version, string $name): ?array {
		try {
			$json = json_decode($this->appDataFactory->get(Application::APP_ID)->getFolder((string)$version->getId())->getFile($name)->getContent(), true);
		} catch (NotFoundException) {
			return null;
		}
		return is_array($json) ? $json : null;
	}

	/**
	 * A Waveform and duration the browser worked out by decoding the file,
	 * where the server has no ffmpeg to do it, or the delivering tool had
	 * anyway (ADR 0012). Only taken when there is no Waveform and nothing on
	 * its way: neither ever overrides the server, while a Waveform the server
	 * makes later (ffmpeg's, a WAV's PCM) replaces theirs. The duration counts
	 * Frames of the Version, for audio milliseconds also before the probe.
	 *
	 * @param mixed $peaks one byte a peak in base64, as the Waveform stores them
	 * @param int $rate peaks a second, as waveformRate() has it for the duration
	 * @param mixed $loudness optional, as loudnessOf() has it (A5)
	 * @param ?string $etag optional: the ETag of the content decoded, as its upload came back with it
	 * @throws InvalidRequestException peaks, rate, duration or loudness out of shape
	 * @throws ProjectConflictException the Version has a Waveform or is getting one
	 * @return Version as it is now, read where it was a video not read yet
	 */
	public function acceptWaveform(Version $version, mixed $peaks, int $rate, int $durationFrames, mixed $loudness = null, ?string $etag = null): Version {
		$loudness = self::handedLoudness($loudness);
		// The uploading browser names what it decoded; a file written again since has another Waveform
		if ($etag !== null && $etag !== '') {
			$this->assertContent($version, $etag);
		}
		// A peak a byte, so the base64 of the most a Waveform has is a third longer
		$bytes = is_string($peaks) && strlen($peaks) <= 4 * (int)ceil(self::WAVEFORM_MAX_PEAKS / 3) ? base64_decode($peaks, true) : false;
		if ($bytes === false || $bytes === '' || strlen($bytes) > self::WAVEFORM_MAX_PEAKS || $durationFrames < 1) {
			throw new InvalidRequestException('A Waveform is 1 to ' . self::WAVEFORM_MAX_PEAKS . ' peaks, one byte each in base64, over a duration of at least one Frame');
		}
		// A video's pass from the browser may be quicker than the background job that reads it (#168)
		if ($version->getPlayable() === null && str_starts_with((string)$this->fileOf($version)?->getMimeType(), 'video/')) {
			$version = $this->readNow($version);
		}
		// Also before the probe ran (playable is still unknown then), so a delivering tool can hand in its peaks with the upload
		if (!$version->getHasAudio() && $version->getPlayable() !== null || $version->getWaveformState() !== self::STATE_NONE) {
			throw new ProjectConflictException('This Version has its Waveform from the server');
		}
		// The Version's own length once read; where it has a rate but no length (an MKV without Duration), the one handed in, in its Frames; before it is read, in milliseconds, as a delivering tool hands in audio
		$fps = $version->getFpsNum() && $version->getFpsDen() ? $version->getFpsNum() / $version->getFpsDen() : null;
		$seconds = $fps === null ? $durationFrames / 1000 : ($version->getDurationFrames() ?? $durationFrames) / $fps;
		$expected = self::waveformRate($seconds);
		if ($rate !== $expected) {
			throw new InvalidRequestException('A Waveform of this duration has ' . $expected . ' peaks a second');
		}
		// Sound that runs on past the length, as a decoder may find, or a video's past its picture, is left out
		$this->put($version, 'waveform', self::waveformJson($rate, substr($bytes, 0, max(1, (int)ceil($seconds * $rate))), $loudness));
		if ($version->getDurationFrames() === null) {
			$version->setDurationFrames($durationFrames);
		}
		$version->setWaveformState(self::STATE_READY);
		return $this->versions->update($version);
	}

	/** Whether the server lacks ffmpeg, so browsers make Waveforms and Proxies (ADRs 0012, 0019); ffmpeg may have come since the last look */
	public function withoutFfmpeg(): bool {
		return $this->withoutFfmpegNow ??= !$this->ffmpeg->available() && $this->ffmpeg->probe() === null;
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
			$job->setClaimedBy(Job::BROWSER);
			$job->setCreatedAt($this->time->getTime());
			$job = $this->jobs->insert($job);
		} elseif ($job->getClaimedBy() !== Job::BROWSER) {
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
		return in_array($version->getProxyState(), [self::STATE_NONE, self::STATE_FAILED], true)
			&& $this->takesProxy($version, $bytes)
			&& $this->withoutFfmpeg();
	}

	/**
	 * What a browser is to make of this Version where the server has no
	 * ffmpeg (#168), in one pass: its Proxy where proxyFromBrowser() says so,
	 * and the Thumbnail Strip, Waveform and Scrub Proxy it lacks. Nothing for
	 * a Version without a picture or not read yet, nor while a browser makes
	 * its Proxy, as that pass brings the rest along.
	 *
	 * @param int $bytes the size of the Version's file, for the Proxy bitrate threshold
	 * @return list<string> of 'proxy', 'thumbs', 'waveform' and 'scrub'
	 */
	public function fromBrowser(Version $version, int $bytes): array {
		if (!$version->getHasVideo() || $version->getPlayable() === null || $version->getProxyState() === self::STATE_RUNNING || !$this->withoutFfmpeg()) {
			return [];
		}
		return array_keys(array_filter([
			'proxy' => $this->proxyFromBrowser($version, $bytes),
			'thumbs' => $version->getThumbsState() === self::STATE_NONE,
			'waveform' => $version->getHasAudio() && $version->getWaveformState() === self::STATE_NONE,
			'scrub' => $version->getScrubState() === self::STATE_NONE,
		]));
	}

	/**
	 * Whether the Version, once read, gets a Proxy (ADR 0019), so one may be
	 * handed in (ADR 0020)
	 *
	 * @param int $bytes the size of the Version's file, for the Proxy bitrate threshold
	 */
	public function takesProxy(Version $version, int $bytes): bool {
		return $version->getPlayable() !== null && $this->needsProxy($version, $bytes);
	}

	/** A browser that has not reported for a while closed its tab: its Proxy counts as missing again (spec: Proxies from the browser) */
	public function lapse(Version $version): void {
		if ($version->getProxyState() !== self::STATE_RUNNING) {
			return;
		}
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROXY);
		if ($job?->getClaimedBy() === Job::BROWSER && $job->getStartedAt() < $this->time->getTime() - self::BROWSER_LAPSE) {
			$this->jobs->delete($job);
			$version->setProxyState(self::STATE_NONE);
			$this->versions->update($version);
		}
	}

	/**
	 * Takes a Proxy handed in, from the uploading browser (ADR 0019) or made
	 * by hand (ADR 0020), after checking it as the browser did: H.264/AAC MP4
	 * that browsers play, within the Proxy resolution, with as many Frames as
	 * the original at its rate, so that every Frame anchor holds. It replaces
	 * a Proxy ffmpeg made and withdraws a job making one. A Proxy a browser
	 * converted (`$converted`) keeps ADR 0019's rules: only without ffmpeg,
	 * never over a Proxy that is there, one by hand above all. A Proxy that
	 * does not match is refused; only a conversion then shows as failed, a
	 * Proxy there or on its way stays.
	 *
	 * @param bool $converted whether a browser converted it from the original, rather than someone rendering it by hand
	 * @throws ProjectConflictException the Version needs no Proxy, is not read yet, or, for a conversion, the server has ffmpeg or the Version its Proxy
	 * @throws InvalidRequestException the upload is no Proxy of this Version
	 */
	public function acceptProxy(Version $version, File $original, File $upload, bool $converted = false): void {
		if ($converted) {
			$this->assertBrowserProxy($version);
		}
		$source = $this->probe->localPath($original);
		$candidate = $this->probe->localPath($upload);
		if ($source === null || $candidate === null) {
			throw new \RuntimeException('The files are not readable');
		}
		$version = $this->readNow($version);
		$probed = $this->container->read($source) ?? [];
		if (!$this->needsProxy($version, (int)filesize($source))) {
			throw new ProjectConflictException('This Version plays without a Proxy');
		}
		$error = $this->mismatch($version, $probed, $this->container->read($candidate), (int)filesize($candidate));
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROXY);
		if ($error !== null) {
			if ($converted) {
				if ($job?->getClaimedBy() === Job::BROWSER) {
					$this->jobs->delete($job);
				}
				$this->mark($version->getId(), Job::KIND_PROXY, self::STATE_FAILED, $error);
			}
			throw new InvalidRequestException($error);
		}
		// First: a job of the server running meanwhile looks before it writes, and finds itself withdrawn
		if ($job !== null) {
			$this->jobs->delete($job);
		}
		$stream = $upload->fopen('r');
		try {
			$this->put($version, 'proxy', $stream);
		} catch (\Throwable $e) {
			$this->mark($version->getId(), Job::KIND_PROXY, self::STATE_FAILED, 'The Proxy could not be stored');
			throw $e;
		} finally {
			if (is_resource($stream)) {
				fclose($stream);
			}
		}
		$version = $this->versions->find($version->getId()) ?? throw new \RuntimeException('The Version is gone');
		$version->setProxyHandedIn(true);
		$version->setProxyState(self::STATE_READY);
		$this->versions->update($version);
		$this->notifications->browserPassDone($version);
	}

	/** The Managers hear that a browser has to make the Proxy; the mail is optional, the notification is not (ADR 0019) */
	private function askBrowserPass(Version $version): void {
		$managers = $this->notifications->browserPassNeeded($version);
		$this->browserPassMail->needed($version, $managers);
	}

	/**
	 * Removes a Proxy handed in (ADR 0020). Then the normal path takes over:
	 * with ffmpeg its Proxy is queued at once, without the Asset card offers
	 * the browser's again. A Proxy ffmpeg made is not removed: it would come
	 * right back.
	 *
	 * @param int $bytes the size of the Version's file, for the Proxy bitrate threshold
	 * @throws ProjectConflictException the Version has no Proxy handed in
	 */
	public function removeProxy(Version $version, int $bytes): void {
		if (!$version->getProxyHandedIn()) {
			throw new ProjectConflictException('This Version has no Proxy handed in');
		}
		try {
			$this->folder($version->getId())->getFile(self::FILES['proxy'])->delete();
		} catch (NotFoundException) {
			// gone with app data
		}
		$version->setProxyHandedIn(false);
		$version->setProxyState(self::STATE_NONE);
		$this->versions->update($version);
		if (!$this->withoutFfmpeg() && $this->needsProxy($version, $bytes)) {
			$this->enqueue($version->getId(), Job::KIND_PROXY);
		}
	}

	/**
	 * The Version once its original is read: an upload from the browser may be
	 * quicker than the background job that reads it, so this request reads it
	 *
	 * @throws ProjectConflictException the original cannot be read now
	 */
	private function readNow(Version $version): Version {
		if ($version->getPlayable() !== null) {
			return $version;
		}
		$job = $this->jobs->findPending($version->getId(), Job::KIND_PROBE);
		// Claimed as by any worker: should the request die, the probe is queued again like theirs
		if ($job !== null && $this->jobs->claim($job, Job::REQUEST, $this->time->getTime())) {
			$this->process($job);
		}
		$version = $this->versions->find($version->getId()) ?? throw new \RuntimeException('The Version is gone');
		if ($version->getPlayable() === null) {
			throw new ProjectConflictException('The original is not read yet');
		}
		return $version;
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
	 * @param int $bytes the Proxy's size
	 * @return ?string why the Proxy does not fit the Version, null when it does
	 */
	private function mismatch(Version $version, array $original, ?array $proxy, int $bytes): ?string {
		$picture = $this->videoOf($proxy);
		if ($proxy === null || $picture === null || !str_contains((string)($proxy['format']['format_name'] ?? ''), 'mp4') || !$this->browserPlays($proxy)) {
			return 'The Proxy is no H.264/AAC MP4 that browsers play';
		}
		if (min((int)($picture['width'] ?? 0), (int)($picture['height'] ?? 0)) > $this->maxHeight()) {
			return 'The Proxy is larger than the Proxy resolution';
		}
		if ($this->heavy($bytes, (float)($picture['duration'] ?? 0))) {
			return 'The Proxy goes above the Proxy bitrate threshold of ' . $this->maxBitrate() . ' Mbit/s';
		}
		if ($version->getHasAudio() && !array_filter($this->probe->streams($proxy), static fn (array $stream) => ($stream['codec_type'] ?? '') === 'audio')) {
			return 'The Proxy has no sound, the original has';
		}
		return $this->otherFrames($version, $original, $picture, 'Proxy');
	}

	/**
	 * @param array<string, mixed> $original what the original's headers say
	 * @param array<string, mixed> $picture the video stream of the rendition
	 * @param string $what the rendition, as the message names it
	 * @return ?string why its Frames are not the original's at its rate, null when they are
	 */
	private function otherFrames(Version $version, array $original, array $picture, string $what): ?string {
		$num = (int)$version->getFpsNum();
		$den = (int)$version->getFpsDen();
		$made = (int)($picture['nb_frames'] ?? -1);
		$frames = $this->videoOf($original)['nb_frames'] ?? null;
		if ($num < 1 || $den < 1 || $frames !== null && $made !== (int)$frames) {
			return "The $what has other Frames than the original's $frames";
		}
		// WebM and MKV do not count their Frames, and their length includes the sound, which may run on a little
		if ($frames === null && abs($made - (int)$version->getDurationFrames()) > max(1, (int)round($num / $den / 5))) {
			return "The $what has other Frames than the original's " . (int)$version->getDurationFrames();
		}
		// Within half a Frame over the whole length, so the rate cannot drift a Frame anywhere
		if (abs((float)($picture['duration'] ?? 0) - $made * $den / $num) > $den / $num / 2) {
			return "The $what runs at another frame rate than the original";
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
	 * Whether browsers play the original: H.264/AAC in MP4 and VP8/VP9
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
	private function needsProxy(Version $version, int $bytes): bool {
		return $version->getHasVideo()
			&& (!$version->getPlayable() || $this->heavy($bytes, $this->durationSeconds($version, 0.0)));
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

	/** Reads `out_time_us` from ffmpeg's progress output */
	private function progressed(string $chunk): void {
		if (preg_match_all('/^out_time_us=(\d+)/m', $chunk, $m) > 0) {
			$this->reached((int)end($m[1]));
		}
	}

	/** Writes how far the running job has got now and then */
	private function reached(int $microseconds): void {
		if ($this->running === null) {
			return;
		}
		$percent = self::percent($microseconds, $this->running['seconds']);
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

	/**
	 * Writes under a name of its own first and gives it its name only when
	 * the running job still stands: copying a large Proxy takes a while, in
	 * which a Proxy handed in or a regeneration may withdraw the job.
	 *
	 * @param string|resource $content
	 */
	private function put(Version $version, string $kind, $content, ?string $name = null): void {
		$this->guard();
		$name ??= self::FILES[$kind];
		$written = $this->folder($version->getId())->newFile('.' . $name . '.' . bin2hex(random_bytes(4)));
		try {
			$written->putContent($content);
			$this->guard();
			$node = $this->root->get($this->root->getAppDataDirectoryName() . '/' . Application::APP_ID . '/' . $version->getId() . '/' . $written->getName());
			$node->move(dirname($node->getPath()) . '/' . $name);
		} catch (\Throwable $e) {
			try {
				$written->delete();
			} catch (\Throwable) {
				// gone with its folder
			}
			throw $e;
		}
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
			return $folder->getFile(self::THUMBS_JPEG);
		}
	}

	/** Deletes the derived media and open jobs of a Version */
	public function forget(int $versionId): void {
		$this->jobs->deleteBy('version_id', $versionId);
		$version = $this->versions->find($versionId);
		if ($version !== null) {
			$version->setProxyState(self::STATE_NONE);
			// A Proxy handed in goes with the rest: ffmpeg or the browser makes the next (ADR 0020)
			$version->setProxyHandedIn(false);
			$version->setThumbsState(self::STATE_NONE);
			$version->setWaveformState(self::STATE_NONE);
			$version->setScrubState(self::STATE_NONE);
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
	private function maxBitrate(): int {
		return $this->settings->proxy()['maxBitrate'];
	}

	private function maxHeight(): int {
		return $this->settings->proxy()['maxHeight'];
	}

	/** The length of a Version in seconds, from its Frames and rate; an unknown length counts as `$unknown` (a minute for spacing Thumbnails, 0 where it must not count as heavy) */
	private function durationSeconds(Version $version, float $unknown = 60.0): float {
		$frames = $version->getDurationFrames();
		$num = $version->getFpsNum();
		$den = $version->getFpsDen();
		if ($frames === null || !$num || !$den) {
			return $unknown;
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
		// The loudness has no state on the Version, and its failure fails nothing a Member sees: the job keeps its error for the admin
		if ($version === null || $kind === Job::KIND_LOUDNESS) {
			return;
		}
		match ($kind) {
			Job::KIND_PROXY => $version->setProxyState($state),
			Job::KIND_THUMBS => $version->setThumbsState($state),
			Job::KIND_WAVEFORM => $version->setWaveformState($state),
			Job::KIND_SCRUB => $version->setScrubState($state),
			default => null,
		};
		if ($error !== null) {
			$version->setDerivedError($error);
		}
		$this->versions->update($version);
	}
}
