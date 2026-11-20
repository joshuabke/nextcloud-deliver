---
status: accepted
---

# An audio upload's Waveform is made in its own request

ADR 0003 has all derived media made by Nextcloud's background jobs, one ffmpeg at a time by default. On a plain install that is cron every five minutes, and a fresh audio upload's Waveform waited for the next cron run, then behind every Proxy queued before it: a reviewer opening the mix right after the upload found none. Audio is cheap to read, so with ffmpeg the first audio file a request brings (an upload in Files, a sync client, Deliver's own upload, delivering again) is read and gets its Waveform in that request, and it is there when the upload is.

Only within bounds, so an upload never waits long and a request never does a job's work:
- a file on local, unencrypted storage (elsewhere ffmpeg would read a copy made first at that storage's speed), of 1 byte to 256 MB, at most 15 minutes long and at no more bytes a second than 192 kHz 32-bit stereo PCM;
- ffprobe and ffmpeg each for at most 15 seconds, ffmpeg no further than the header's length and 5 seconds;
- at most `max_jobs` requests at once, beside the queue's own `max_jobs`: with one shared count an audio upload beside a running Proxy would wait for the queue again, which is what this changes;
- one file a request: a request that brings many (a sync client's bulk upload of up to about a hundred small files, an app unpacking an archive) reads only its first, so it stays within 30 seconds, and its others go to the queue; never a folder taken in at once (a Folder Project made or switched to Auto Intake, the hourly scan).

Whatever is outside the bounds or runs out of time goes on in the queue, as before. The jobs are claimed in the job table as a worker claims them, and a request's claim that is still running after five minutes is queued again. Nothing of it can fail the upload. In the queue, probes come first and then the Waveforms of audio, before the rest.

## Considered Options

- Priority in the queue alone: still up to five minutes until the next cron run, and behind a Proxy that is running.
- One `max_jobs` for requests and queue together: the tester's case, audio uploaded beside a video whose Proxy runs, would be left to the queue.
- Reading in the request whatever the length: a 10-hour file would hold a sync client's PUT for a minute.

## Consequences

- With ffmpeg, up to twice `max_jobs` ffmpeg processes can run at once: the queue's and the requests'.
- A delivering tool's Waveform hand-in after an upload gets 409 where the server has ffmpeg, as the Waveform is the server's already.
- ADR 0003's "jobs run in Nextcloud's background queue" holds for everything else; this supersedes it for the Waveform (and probe) of a single audio upload within the bounds.
