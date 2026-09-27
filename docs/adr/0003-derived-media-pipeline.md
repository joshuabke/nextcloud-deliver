---
status: accepted
---

# ffmpeg is optional, derived media is cache in app data, jobs run in Nextcloud's background queue

Deliver must install from the App Store on hosts without ffmpeg, so playback of browser-native files and all review features work with no binary present; Proxies, Thumbnail Strips and Waveforms are generated only when ffmpeg/ffprobe are found (auto-detected, path overridable in admin settings). Derived media lives in `appdata_deliver/`, never inside the Project folder, because it is regenerable cache and must not reach sync clients or shares. Generation runs as Nextcloud background jobs (one ffmpeg at a time by default); an optional `occ deliver:worker` process drains the same job table faster on installs that want throughput.

## Considered options

- Require ffmpeg: rejected, blocks App Store installs on shared hosting.
- Store proxies in a hidden `.deliver/` folder next to the sources: rejected, desktop sync clients would pull every proxy and shares would expose them.
- External transcoding worker over HTTP (GPU machines pulling jobs): deferred; the job table is designed so it can be added without a schema change.

## Consequences

- A single Proxy rendition: H.264/AAC MP4 at source fps, capped at the admin-configured resolution on the short side (default 1080p), 1 s keyframe interval. A browser-native source always plays as the original by default; above the cap it also gets a Proxy as a lighter alternative for slow connections and devices, within the cap only Thumbnail Strip and Waveform.
- Proxies keep the exact source frame rate so Frame anchors stay valid; variable-frame-rate sources are conformed to their average rate.
- Losing `appdata_deliver/` loses nothing but time; `occ deliver:regenerate` rebuilds it.
