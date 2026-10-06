# Running Deliver

For admins: what Deliver needs, what it does in the background, and how to tune it. The words are those of [CONTEXT.md](../CONTEXT.md).

## Requirements

- Nextcloud 33 or 34 (the Files sidebar tab API this app uses shipped with 33)
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

Cron takes jobs from the same queue every five minutes, for up to four minutes per run. The app setting `max_jobs` (default 1) caps how many ffmpeg processes run at once across cron and all workers; a job whose worker died is queued again after two hours. Without ffmpeg the app keeps working: browser-native files play as they are, and only Proxies and Thumbnail Strips are missing (hover previews on the timeline come from the file itself). A WAV's Waveform is read from its PCM on the server; other audio is decoded once by the browser of the first Member who opens it, which hands the Waveform and the duration to the server. The export "WAV with markers" is offered only for WAV sources. Deliver then reads what Frames rest on from the container itself: the frame rate, the duration and the start timecode of a MOV or MP4 (its timecode track, drop-frame included) and the time reference of a Broadcast WAV, so exported markers still land on an editing timeline that starts at 01:00:00:00. WebM and MKV keep their frame rate, size and duration. An MP3, FLAC or M4A keeps the start its delivering tool wrote into its tag, a FLAC its exact duration. MP3, AAC, FLAC and Ogg are recognised as audio, which counts in milliseconds anyway. Other containers (MXF, AVI) take the Project's frame rate and start at 0; the admin status names them as files Deliver cannot read without ffmpeg.

Admins configure the pipeline under *Administration → Deliver*: the paths to ffmpeg and ffprobe (empty means whatever is on the PATH), how many jobs run at once, the maximum Proxy height, the Thumbnail Strip cap, extra ffmpeg arguments for Proxies, and a hardware encoder (VAAPI with its device path, NVENC or VideoToolbox). Saving runs a one-second test encode; a hardware encoder that fails it stays configured but unused, and a Proxy it fails on later is made again with libx264. The same page shows the ffmpeg versions, the queue and the stderr of the last failed job. `max_jobs`, `max_height` and friends are ordinary app config values, so `occ config:app:set deliver …` works as well.

For VAAPI in Docker, pass `/dev/dri` into the container **and** put the web server's user into the group that owns `/dev/dri/renderD128`: `group_add` in compose only reaches the container's first process, and Apache drops it when it switches to `www-data`. `deploy/Dockerfile` does this with the build argument `RENDER_GID`.

An hourly scan compares every Project with its folder, next to the file listener: it catches deletions from the trash, which fire no event Deliver can hear, and turns a Folder Project whose folder is gone for good into a plain Project.

## Live updates

The Review view asks for changes every five seconds (thirty in a hidden tab). Where Nextcloud runs the [notify_push](https://github.com/nextcloud/notify_push) app, every new or changed Comment, Reaction or Approval is pushed to the Project's Members as well, and their open Review views update at once. Reviewers on a Project Link have no account to push to and keep polling.

## Troubleshooting

Everything here works without a shell, as on a hosted Nextcloud.

- **Overview** (Administration settings → Overview) carries two checks of Deliver's: background jobs should run by Cron, since with AJAX Deliver makes media only while someone has a page open and Due Date reminders come late; and failed media jobs, with a link to Deliver's settings.
- **Deliver's settings** show the queue and the last failure with ffmpeg's output, and retry all failed jobs once the cause is fixed.
- **The Nextcloud log** (the Logging app) has every failed media job and every mail that could not be sent, under the app `deliver`.
- **Support report**: Deliver's settings download a JSON file with the versions of Deliver, Nextcloud, PHP and the database, the background job mode, the media settings, the queue with its last ten failures and how many Projects, Versions, Comments and links there are. It holds no names, Comments or Reviewers, but ffmpeg's output can carry file paths: read it before you attach it to an issue.

Deliver's data lives in Nextcloud's database (`oc_deliver_*` tables) and derived media in app data, so a Nextcloud backup covers it. Deliver offers no export of its own tables: they hold Reviewers' addresses and link password hashes, which belong in a backup, not in a bug report.

## Deployment

`deploy/` has a Compose example for a server of your own: Nextcloud with ffmpeg and the VAAPI drivers, Postgres, Redis, a cron container and an optional derived-media worker. See [deploy/README.md](../deploy/README.md).

