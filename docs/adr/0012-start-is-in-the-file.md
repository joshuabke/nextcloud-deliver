---
status: accepted
---

# The start is in the file; the Waveform is derived media

ADR 0005 had the delivering tool write a `deliver.json` Sidecar beside the files, with each file's Session Time and peaks, because managed hosts have no ffmpeg and the container probe read no MP3. A second file that has to travel with the first breaks what Files as the source of truth (ADR 0002) promises: copy, move or sync one MP3 and its start is gone. So the start goes into the file itself. A Broadcast WAV carries it already as `time_reference`; the delivering tool (reaper-deliver) writes it as `DELIVER_TIME_REFERENCE`, in samples since midnight like `time_reference`, into each format's own tag: an MP3's ID3v2 TXXX frame, a FLAC's Vorbis comment, an M4A's iTunes freeform atom. Deliver reads it with ffprobe, which names each as a format tag, and without ffmpeg from the tag itself, so both give the same start.

The Waveform stays what it is, derived media in app data, like a DAW's peak file next to its recording: from ffmpeg, from a WAV's PCM, from the delivering tool, which knows the peaks anyway and hands them in over the API right after the upload, or from the first browser that decodes the file. Neither the tool nor a browser overrides a Waveform the server made; one the server makes later replaces theirs.

## Considered Options

- Keeping the Sidecar (ADR 0005): a second file to keep in step with the first, outside Files' own handling of it.
- Peaks in the file as well, in a second TXXX frame: they belong to the file no more than a DAW's peak file does, and every Delivery would rewrite the tag.
- Bundling ffmpeg: Deliver would have to build and maintain it for every platform, and managed hosts such as Hetzner refuse ffmpeg on purpose, for the load it puts on shared machines.
- Bundling another decoder: BBC audiowaveform, sox and mpg123 have no static Linux build to ship.
- Estimating loudness in PHP from the MP3 side information (`global_gain`): prototyped, it follows the real peaks poorly (r ≈ 0.25–0.43 at 128 kbit/s and VBR).

## Consequences

- Deliver ships no binaries of its own. Where neither ffmpeg nor the delivering tool gives a Waveform, the browser decodes the file once.
- `DELIVER_TIME_REFERENCE` is a contract with reaper-deliver, written down in the spec; it changes only compatibly.
- A Waveform can be handed in before the probe has run, so a tool does not wait for a background job that on cron-driven hosts starts minutes later. Its duration counts milliseconds, as audio does (ADR 0007).
- How a Delivery marks a Take Folder and orders its lanes, which the Sidecar also carried, is decided with the Takes milestone.
- ADR 0005 is superseded.
