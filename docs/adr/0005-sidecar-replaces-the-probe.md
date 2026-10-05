---
status: superseded by [0012](0012-start-is-in-the-file.md)
---

# A Sidecar from the delivering tool replaces the probe

Managed Nextcloud hosts have no ffmpeg and never will, and the container probe reads MOV, MP4 and Broadcast WAV but not MP3, and computes no Waveform. Takes and Mixes from REAPER arrive as MP3 to stay streamable, so without help they would start at 0 and have no Waveform — the Take comparison would be impossible on exactly the hosts it is meant for. The tool that renders the files knows their Session Time and peaks exactly, so it writes them into a `deliver.json` Sidecar beside the files, and Deliver takes a Sidecar entry as the probe result for that file, ahead of ffprobe and the container probe.

## Considered Options

- Decoding in the browser with WebAudio: thirty Takes of several minutes each cost gigabytes of PCM and minutes of waiting on every open.
- ID3 tags in the MP3: carries a start time but no Waveform, and needs an ID3 parser in PHP for one producer.
- Delivering Broadcast WAV: the container probe already reads it, but a session of Takes runs to gigabytes, too heavy to stream to clients.

## Consequences

- The Sidecar format is a contract with reaper-deliver and carries a format version; it changes only compatibly.
- A Sidecar is ordinary content in Files (ADR 0002): moving the folder moves it, deleting it falls back to probing.
- ffmpeg still builds Proxies where a file needs one; it never overrides what a Sidecar says.
