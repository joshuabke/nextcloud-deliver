---
status: accepted
---

# Waveform peaks at a fixed rate

A Waveform had 2000 peaks over the whole length, whatever that was: a 3-minute song got one peak every 90 ms, a 1-hour mix one every 1.8 s, so a zoomed or scrolling Waveform showed blocks instead of a wave the longer the file. A Waveform now has its peaks at a fixed rate, 50 a second, made the same way by ffmpeg, from a WAV's PCM, in the browser and by the delivering tool: peak i is the loudest sample over all channels from i / rate to (i + 1) / rate seconds into the file, so there are about as many as the seconds times the rate and the last one may cover less. 15 seconds on a 1200 px wide stage are 750 peaks, still a wave.

It is stored and served as `{"rate": 50, "peaks": "<base64>"}`, one byte a peak (0 silence, 255 full scale, linear). One hour is 180 000 peaks, 240 KB; ten hours 2.4 MB. The file says its rate: where a file is so long that it would go past 2 000 000 peaks (past 11 hours at 50), the rate is the most whole peaks a second that stay within that, `max(1, min(50, floor(2000000 / ceil(seconds))))`, the same rule for every producer and in the hand-in's check. There is no second format: the hand-in takes only this shape, at the rate of the duration handed in, and with about that many peaks (a second either way).

Making one keeps only the peaks in memory: ffmpeg writes 8 kHz mono PCM to a temporary file that PHP reads one peak's share at a time; a WAV is read the same way from its PCM, at most 1 GiB in all; the browser grows its peaks as the decoder goes.

Every Waveform made before counts as missing: a migration sets the state of every ready one to none. With ffmpeg the hourly scan queues them, twenty at a time, only while nothing but Scrub Proxies waits in the queue, so they never hold up an upload; without ffmpeg the browser ways remake them (the first Member who opens audio, the card's pass for video).

## Considered Options

- 2000 peaks and a second resolution for zooming: two formats for one thing, and the coarse one still wrong for long files.
- A version marker in the stored file and readers that tell old from new: a second input shape in every reader; the migration drops them once instead.
- Peaks as JSON numbers, 0 to 1 or 0 to 255: 3 to 6 bytes a peak, 6.5 MB and more for ten hours, as Nextcloud's Apache does not compress JSON; base64 bytes are 1.33 bytes a peak without relying on compression, and no value can be out of range.
- 100 peaks a second: twice the size for detail a review does not need below 15 seconds a screen.

## Consequences

- The timeline's whole-length view draws a downsampled overview of the peaks (`src/lib/waveform.js` `overview`), the scrolling Waveform reads them at their rate.
- Delivering tools hand in the new shape (docs/api.md); the old one is refused with 400.
- Nothing of ADR 0012 changes but the shape: the Waveform stays derived media in app data, and who may hand one in stays as it was.
