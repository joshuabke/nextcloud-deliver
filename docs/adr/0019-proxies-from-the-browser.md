---
status: accepted
---

# Proxies come from the uploading browser where there is no ffmpeg; one bitrate rule decides who gets one

ADR 0003 made Proxies an ffmpeg job, so a server without ffmpeg (managed hosting, ADR 0012) leaves a master that browsers do not play, a ProRes cut above all, unplayable. The browser that uploads the master holds it anyway, as it holds audio whose Waveform it decodes (ADR 0012). Mediabunny, which already decodes those Waveforms, converts video too: it decodes with WebCodecs and, for ProRes, which no browser decodes, with its WASM decoder `@mediabunny/prores` (MPL-2.0); it encodes H.264 with WebCodecs, usually in hardware. So on a server without ffmpeg the uploading browser makes the Proxy while the master uploads, checks it, and hands it in once the Version exists. The server checks it again from its headers and keeps it in app data like any Proxy.

Who gets a Proxy changes with it, for ffmpeg and browsers alike. A Proxy existed for a source browsers do not play, and for a playable one whose short side was above the Proxy resolution. What slows playback on a weak connection is the bitrate, not the size, so the second rule becomes the Proxy bitrate threshold, an admin setting of 20 Mbit/s by default: a playable original above it gets a Proxy as the lighter choice, and no Proxy goes above it. AV1 no longer counts as playable, as only recent Apple hardware decodes it.

## Considered options

- A Proxy the editor renders and puts next to the Version: kept for later (#166), the browser covers everyone who uploads through Deliver.
- Google Drive's transcodes: no API hands them out, their frame rate is not ours to check, and the media would leave Files (ADR 0002).
- ffmpeg compiled to WASM: tens of MB to load and far slower than the browser's own hardware encoder.
- An external worker with ffmpeg over HTTP: needs a machine of its own; still possible later on the same job table.

## Consequences

- Only without ffmpeg. With ffmpeg nothing changes, and a Proxy the browser made is replaced only when the Version is regenerated.
- The browser hands its Proxy in only for a Version a Member with Manage has: the upload lies next to the Version's file as for a replace, and `POST /versions/{id}/proxy` checks that it is H.264/AAC MP4 that browsers play, within the Proxy resolution, with the original's Frames at its rate within half a Frame over the whole length. A Proxy that does not fit is refused and the Version shows that its Proxy failed.
- While it converts, the browser reports its progress (`POST /versions/{id}/proxy/progress`) as a running job of its own, which counts towards no limit of the server's queue. Two minutes without a report and the Proxy counts as missing again.
- A hardware encoder that knows only a constant quality cannot keep below the threshold; a Proxy it makes above it is made again in software, as one it fails on.
- Deliver's page stays without cross-origin isolation (COOP/COEP). Measured on an M4 Max, it made the whole conversion at most about 12 % faster, in Chrome from 4K to 1080p only; Firefox gained a little only from 4K to 4K and Safari nothing (single runs, docs/admin.md). Isolation could make scripts of other apps fail silently on Deliver's page and would not reach uploads in the Files app. `COEP: credentialless` is the gentler option, should 4K masters run short of memory in Firefox.
- DNxHD/DNxHR has no browser decoder, so without ffmpeg it stays unplayable (#167).
- This supersedes ADR 0003 where it makes Proxies need ffmpeg and gives large originals a Proxy by their size.
