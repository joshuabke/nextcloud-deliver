# Running Deliver

For admins: what Deliver needs, what it does in the background, and how to tune it. The words are those of [CONTEXT.md](../CONTEXT.md).

## Requirements

- Nextcloud 33 to 35 (the Files sidebar tab API this app uses shipped with 33)
- PHP 8.2 or newer
- ffmpeg/ffprobe are optional and only needed for derived media (Proxies, Thumbnail Strips, Waveforms)
- For the still that identifies an Asset in a list, Nextcloud's own Movie preview provider has to be enabled by an admin (`occ config:system:set enabledPreviewProviders N --value 'OC\Preview\Movie'`); without it the list falls back to an icon

## File locks

Deliver locks the file of every Version with Comments or Approvals through Nextcloud's file locking app `files_lock` (shipped, enabled by default; ADR 0018). Without it, or with a Project's switch off, nothing is locked and an overwrite is marked and notified instead. The lock shows in Files as held by Deliver; the file's owner lifts it there, and `occ files:lock --unlock <file id>` lifts it from the command line. A lifted lock comes back with the next Comment or Approval on that Version, or when the Project's setting is switched off and on. If you set a lock timeout in `files_lock`, Deliver's locks expire with it.

## Derived media

`ffprobe` reads the frame rate as a fraction, the start timecode and the duration in Frames; `ffmpeg` makes a Proxy for anything a browser will not play and for originals above the Proxy bitrate threshold, a WebP Thumbnail Strip for the timeline and a Waveform for the audio. Everything lands in app data, never in a user folder, and is served with byte ranges so the player can seek.

```sh
occ deliver:worker --once              # work through the queue and stop
occ deliver:worker                     # keep working as jobs arrive
occ deliver:regenerate --project-id=1  # delete and rebuild; also --version-id, or neither for everything
```

Cron takes jobs from the same queue every five minutes, for up to four minutes per run. The app setting `max_jobs` (default 1) caps how many ffmpeg processes run at once across cron and all workers; a job whose worker died is queued again after two hours. Without ffmpeg the app keeps working: browser-native files play as they are, and Thumbnail Strips are missing (hover previews on the timeline come from the file itself) except where a browser made the Proxy, as it draws the Thumbnail Strip and the Waveform in the same pass (in Chrome and Firefox; Safari encodes no WebP). A video that needs a Proxy, a ProRes master above all, gets it from the browser that uploads it, in Deliver or in the Files app into a Folder Project with Auto Intake, while it uploads, where that browser decodes it (ADR 0019); for one from a sync client or a delivering tool, a Member with Manage starts it from the Asset card with "Make Proxy in this browser": over https only, as WebCodecs needs a secure page, and the tab has to stay open until the Proxy is handed in. Its upload is a hidden file `.deliver-proxy-…` next to the master for a moment. What the uploading browser can neither play nor convert, DNxHR for instance, is refused before it goes up. A WAV's Waveform is read from its PCM on the server; other audio is decoded by the browser that uploads it in Deliver or in Files, while the file uploads, or else once by the browser of the first Member who opens it, which hands the Waveform and the duration to the server. Over https the browser reads the file piece by piece; a page served over plain http (other than localhost) has no WebCodecs, so there it decodes the whole file at once. The export "WAV with markers" is offered only for WAV sources. Deliver then reads what Frames rest on from the container itself: the frame rate, the duration and the start timecode of a MOV or MP4 (its timecode track, drop-frame included) and the time reference of a Broadcast WAV, so exported markers still land on an editing timeline that starts at 01:00:00:00. WebM and MKV keep their frame rate, size and duration. An MP3, FLAC or M4A keeps the start its delivering tool wrote into its tag, a FLAC its exact duration. MP3, AAC, FLAC and Ogg are recognised as audio, which counts in milliseconds anyway. Other containers (MXF, AVI) take the Project's frame rate and start at 0; the admin status names them as files Deliver cannot read without ffmpeg.

Admins configure the pipeline under *Administration → Deliver*: the paths to ffmpeg and ffprobe (empty means whatever is on the PATH), how many jobs run at once, the maximum Proxy height (720 to 2160 pixels on the short side; below 720p nobody reviews professionally), the Proxy bitrate threshold (20 Mbit/s unless changed: originals browsers play get a lighter Proxy only above it, and no Proxy goes above it; a hardware encoder that does is replaced by libx264 for that Proxy), the Thumbnail Strip cap, extra ffmpeg arguments for Proxies, the default place for the folders of new Projects in each user's Files (`/Deliver` unless changed), how much one person, a Reviewer too, may attach to the Comments on one Version (20 MB unless changed), and a hardware encoder (VAAPI with its device path, NVENC or VideoToolbox). Saving runs a one-second test encode; a hardware encoder that fails it stays configured but unused, and a Proxy it fails on later is made again with libx264. The same page shows the ffmpeg versions, the queue and the stderr of the last failed job. `max_jobs`, `max_height`, `max_bitrate` and friends are ordinary app config values, so `occ config:app:set deliver …` works as well.

For VAAPI in Docker, pass `/dev/dri` into the container **and** put the web server's user into the group that owns `/dev/dri/renderD128`: `group_add` in compose only reaches the container's first process, and Apache drops it when it switches to `www-data`. `deploy/Dockerfile` does this with the build argument `RENDER_GID`.

An hourly scan compares every Project with its folder, next to the file listener: it catches deletions from the trash, which fire no event Deliver can hear, and turns a Folder Project whose folder is gone for good into a plain Project.

### How long a Proxy from the browser takes

Measured on a MacBook Pro with an M4 Max (64 GB, macOS 26.5) in Google Chrome 156, Firefox 156.0.1 and Safari 26.5, from ProRes 422 HQ masters at 25 fps with 24-bit PCM stereo (1080p at 194 Mbit/s for 60 s, 2160p at 773 Mbit/s for 30 s), with the default Proxy bitrate threshold; the time includes the Thumbnail Strip, the Waveform and the check of the finished Proxy. Seconds per minute of master and Frames per second; memory is what the browser's processes took on top while converting (resident size, summed over its processes, so an upper bound). "Isolated" is a page with COOP/COEP (cross-origin isolation), which lets the ProRes decoder share memory between its threads; Deliver's page is not isolated.

| Browser | Isolated | 1080p → 1080p | 2160p → 1080p | 2160p → 2160p | Memory | Thumbnail Strip |
|---|---|---|---|---|---|---|
| Chrome | no | 4.0 s · 371 fps | 8.2 s · 184 fps | 14.9 s · 100 fps | 2.3–3.9 GB | yes |
| Chrome | yes | 3.8 s · 393 fps | 7.2 s · 207 fps | 14.7 s · 102 fps | 1.5–2.1 GB | yes |
| Firefox | no | 6.8 s · 222 fps | 19.4 s · 77 fps | 30.3 s · 50 fps | 4.9–6.0 GB | yes |
| Firefox | yes | 6.7 s · 223 fps | 20.4 s · 73 fps | 28.1 s · 53 fps | 3.0–4.5 GB | yes |
| Safari | no | 3.6 s · 414 fps | 60 s · 25 fps | 14.1 s · 107 fps | 1.3–3.4 GB | no |
| Safari | yes | 3.7 s · 411 fps | 59 s · 25 fps | 14.0 s · 107 fps | 1.5–2.4 GB | no |

So a 10-minute 1080p ProRes master has its Proxy in well under a minute and a half in any of the three, less than its 15 GB take to upload over a gigabit line. A 10-minute 4K master (58 GB) takes about 1¼ minutes to a 1080p Proxy in Chrome, 3½ in Firefox and 10 in Safari, whose scaling is the slow part (its 2160p Proxy, unscaled, takes 2½ minutes, as in Chrome; Firefox 5). The ProRes decoder runs on the CPU, so a smaller machine takes correspondingly longer. Give the browser a few GB of free memory, Firefox the most: a laptop with 8 GB is tight for 4K there. Firefox brings no AAC encoder, so Deliver loads its own; Chrome and Safari use the system's. Cross-origin isolation made Chrome at most an eighth faster and Firefox and Safari not at all, though Chrome and Firefox took 1–2 GB less memory with it.

## Live updates

The Review view asks for changes every five seconds (thirty in a hidden tab). Where Nextcloud runs the [notify_push](https://github.com/nextcloud/notify_push) app, every new or changed Comment, Reaction or Approval is pushed to the Project's Members as well, and their open Review views update at once. Reviewers on a Review Link have no account to push to and keep polling.

## Troubleshooting

Everything here works without a shell, as on a hosted Nextcloud.

- **Overview** (Administration settings → Overview) carries two checks of Deliver's: background jobs should run by Cron, since with AJAX Deliver makes media only while someone has a page open and Due Date reminders come late; and failed media jobs, with a link to Deliver's settings.
- **Deliver's settings** show the queue and the last failure with ffmpeg's output, and retry all failed jobs once the cause is fixed.
- **Large uploads that fail**: Deliver uploads in chunks of the size Nextcloud announces (`files.chunked_upload.max_size`, 100 MiB by default), as the Files app does. Behind a proxy that limits request bodies, such as Cloudflare at 100 MB, lower it: `occ config:system:set files.chunked_upload.max_size --value 52428800 --type integer`.
- **The Nextcloud log** (the Logging app) has every failed media job and every mail that could not be sent, under the app `deliver`.
- **Support report**: Deliver's settings download a JSON file with the versions of Deliver, Nextcloud, PHP and the database, the background job mode, the media settings, the queue with its last ten failures and how many Projects, Versions, Comments and links there are. It holds no names, Comments or Reviewers, but ffmpeg's output can carry file paths: read it before you attach it to an issue.

Deliver's data lives in Nextcloud's database (`oc_deliver_*` tables) and derived media in app data, so a Nextcloud backup covers it. Deliver offers no export of its own tables: they hold Reviewers' addresses and link password hashes, which belong in a backup, not in a bug report.

## Deployment

`deploy/` has a Compose example for a server of your own: Nextcloud with ffmpeg and the VAAPI drivers, Postgres, Redis, a cron container and an optional derived-media worker. See [deploy/README.md](../deploy/README.md).

