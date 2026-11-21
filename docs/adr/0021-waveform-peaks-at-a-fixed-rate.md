---
status: accepted
---

# Waveform peaks at a fixed rate

A Waveform had 2000 peaks over the whole length, whatever that was: a 3-minute song got one peak every 90 ms, a 1-hour mix one every 1.8 s, so a zoomed or scrolling Waveform showed blocks instead of a wave the longer the file. A Waveform now has its peaks at a fixed rate, 50 a second: peak i stands for the sound from i / rate to (i + 1) / rate seconds into the file, so there are about as many as the seconds times the rate and the last one may cover less. 15 seconds on a 1200 px wide stage are 750 peaks, still a wave.

It is stored and served as `{"rate": 50, "peaks": "<base64>"}`, one byte a peak (0 silence, 255 full scale, linear). One hour is 180 000 peaks, 240 KB; ten hours 2.4 MB. The file says its rate: where a file is so long that it would go past 2 000 000 peaks (past 11 hours at 50), the rate is the most whole peaks a second that stay within that, `max(1, min(50, floor(2000000 / ceil(seconds))))`, the same rule for every producer and in the hand-in's check. No Waveform has more than 2 000 000 peaks. There is no second format: the hand-in takes only this shape.

A peak is the loudest sample over all channels of its share: from a WAV's PCM and in the browser at the file's own sample rate, from ffmpeg resampled to 16 kHz, every channel kept, so sound above 8 kHz counts only as far as the resampling keeps it. Peak detection at the file's rate on ffmpeg's side (`astats` every 20 ms) cost 3.5 times the decode; 16 kHz PCM of every channel costs about what the decode does, as did the 8 kHz mono mix before it, which heard sound on one side at half, two sides out of phase and a 6 kHz tone not at all (and any mix to stereo puts mono 3 dB down).

Making one keeps only the peaks in memory: ffmpeg streams its PCM into PHP, which reduces it a share at a time; a WAV is read from its PCM in pieces of at most 512 KiB, at most 1 GiB in all, and a header whose rate would make more peaks than a Waveform has is not read; the browser grows its peaks as the decoder goes, up to the most a Waveform has.

The hand-in takes up to 2 000 000 peaks at the rate of the length: the Version's own once it is read (a video not read yet is read in the request first; one with a rate but no length counts the duration handed in in its Frames), before that the duration handed in, in milliseconds. Peaks past that length are left out rather than refused, as a decoder or a video's sound may run on a little.

Every Waveform made before counts as missing: a migration sets the state of every ready one to none. With ffmpeg, whoever works the queue makes them one at a time whenever it has nothing else to do, so they never hold up an upload, and opening a Version (a Member or a Reviewer) queues its own Waveform ahead of them, so it shows in that visit. Without ffmpeg the browser ways remake them.

The Version's loudness (decision A5) is measured from the same sound: with ffmpeg by a job that follows the Waveform, last in the queue, as ffmpeg's `ebur128` filter at the original rate over every channel gives the integrated loudness and the true peak but costs several times the Waveform itself; without ffmpeg the browser's decode for the Waveform gives the integrated loudness and the true peak (BS.1770-4 Annex 2, decision A9) from the samples the peaks are made of. It is stored as `loudness`, `{"integrated": LUFS, "peak": dB, "truePeak": bool}`, in the same JSON; a Waveform without it (made before, a WAV's PCM read in PHP, a hand-in without it) shows none and is not made again for it.

## Considered Options

- 2000 peaks and a second resolution for zooming: two formats for one thing, and the coarse one still wrong for long files.
- A version marker in the stored file and readers that tell old from new: a second input shape in every reader; the migration drops the old ones once.
- Peaks as JSON numbers, 0 to 1 or 0 to 255: 3 to 6 bytes a peak, 6.5 MB and more for ten hours, as Nextcloud's Apache does not compress JSON; base64 bytes are 1.33 bytes a peak without relying on compression, and no value can be out of range.
- 100 peaks a second: twice the size for detail a review does not need below 15 seconds a screen.
- Queuing the old ones in batches from the hourly scan: they then sit in the queue as ordinary jobs ahead of a later upload.

## Consequences

- The timeline's whole-length view draws a downsampled overview of the peaks (`src/lib/waveform.js` `overview`), the scrolling Waveform reads them at their rate.
- Delivering tools hand in the new shape (docs/api.md); the old one is refused with 400.
- Nothing of ADR 0012 changes but the shape: the Waveform stays derived media in app data, and who may hand one in stays as it was.
