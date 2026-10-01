---
status: accepted
---

# Audio-only Versions count in milliseconds

Audio has no frame rate. Counting it in the Project's frame rate put Takes on a 40 ms grid at 25 fps, audible when switching Takes at the same bar, and a Project often holds video and audio together, so the Project's frame rate cannot simply be set to 1000. An audio-only Version therefore has the frame rate 1000/1 of its own: a Frame is a millisecond, Comments, start timecodes and Takes are exact to it, and "Frames are the anchor" still holds. The Project's frame rate stays the only setting a Member makes; it decides how audio is shown when someone switches from `m:ss.mmm` to timecode or frames.

## Consequences

- Timecode and frame display of audio-only Versions are converted from milliseconds to the Project's frame rate and rounded for display; nothing stored changes when the Project's frame rate does.
- Marker exports for audio workstations take milliseconds directly; no rounding to a picture rate.
- This changes the anchor of audio Comments, so it lands before the first release; afterwards it would need a migration.
