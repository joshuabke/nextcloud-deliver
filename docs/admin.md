# Running Deliver

For admins: what Deliver needs, what it does in the background, and how to tune it. The words are those of [CONTEXT.md](../CONTEXT.md).

## Requirements

- Nextcloud 33 or newer (the Files sidebar tab API this app uses shipped with 33)
- PHP 8.2 or newer
- ffmpeg/ffprobe are optional and only needed for derived media (Proxies, Thumbnail Strips, Waveforms)
- For the still that identifies an Asset in a list, Nextcloud's own Movie preview provider has to be enabled by an admin (`occ config:system:set enabledPreviewProviders N --value 'OC\Preview\Movie'`); without it the list falls back to an icon

## Derived media

`ffprobe` reads the frame rate as a fraction, the start timecode and the duration in Frames; `ffmpeg` makes a Proxy for anything a browser will not play, a WebP Thumbnail Strip for the timeline and a Waveform for the audio. Everything lands in app data, never in a user folder, and is served with byte ranges so the player can seek.

```sh
occ deliver:worker --once              # work through the queue and stop
occ deliver:worker                     # keep working as jobs arrive
occ deliver:regenerate --project-id=1  # delete and rebuild; also --version-id, or neither for everything
```

Cron takes jobs from the same queue every five minutes, for up to four minutes per run. The app setting `max_jobs` (default 1) caps how many ffmpeg processes run at once across cron and all workers; a job whose worker died is queued again after two hours. Without ffmpeg the app keeps working: browser-native files play as they are, and a Version has no derived media. Deliver then reads what Frames rest on from the container itself: the frame rate, the duration and the start timecode of a MOV or MP4 (its timecode track, drop-frame included) and the time reference of a Broadcast WAV, so exported markers still land on an editing timeline that starts at 01:00:00:00. MP3, AAC, FLAC and Ogg are recognised as audio, which counts in milliseconds anyway. Other containers (WebM, MKV) take the Project's frame rate and start at 0; the admin status names them as files Deliver cannot read without ffmpeg.

Admins configure the pipeline under *Administration → Deliver*: the paths to ffmpeg and ffprobe (empty means whatever is on the PATH), how many jobs run at once, the maximum Proxy height, the Thumbnail Strip cap, extra ffmpeg arguments for Proxies, and a hardware encoder (VAAPI with its device path, NVENC or VideoToolbox). Saving runs a one-second test encode; a hardware encoder that fails it stays configured but unused, and a Proxy it fails on later is made again with libx264. The same page shows the ffmpeg versions, the queue and the stderr of the last failed job. `max_jobs`, `max_height` and friends are ordinary app config values, so `occ config:app:set deliver …` works as well.

For VAAPI in Docker, pass `/dev/dri` into the container **and** put the web server's user into the group that owns `/dev/dri/renderD128`: `group_add` in compose only reaches the container's first process, and Apache drops it when it switches to `www-data`. `deploy/Dockerfile` does this with the build argument `RENDER_GID`.

An hourly scan compares every Project with its folder, next to the file listener: it catches deletions from the trash, which fire no event Deliver can hear, and purges Projects whose folder is gone for good.

## Live updates

The Review view asks for changes every five seconds (thirty in a hidden tab). Where Nextcloud runs the [notify_push](https://github.com/nextcloud/notify_push) app, every new or changed Comment, Reaction or Approval is pushed to the Project's Members as well, and their open Review views update at once. Reviewers on a Share Link have no account to push to and keep polling.

## Deployment

`deploy/` has a Compose example for a server of your own: Nextcloud with ffmpeg and the VAAPI drivers, Postgres, Redis, a cron container and an optional derived-media worker. See [deploy/README.md](../deploy/README.md).

