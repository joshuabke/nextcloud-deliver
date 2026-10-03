---
status: accepted
---

# The Sidecar goes through Deliver's API, not into the folder

ADR 0005 stands in why there is a Sidecar: managed Nextcloud hosts have no ffmpeg, the container probe reads no MP3 and computes no Waveform, and the tool that renders the files knows their Session Time and peaks exactly, so what it says stands over any probe. What changes is where the Sidecar lives and how it arrives. ADR 0005 had the tool write a `deliver.json` beside the files; now the tool sends each file's Sidecar to Deliver's API once it has enabled the file: `PUT /ocs/v2.php/apps/deliver/api/v1/versions/{id}/sidecar` with start, duration and Waveform. Deliver stores start and duration on the Version in milliseconds (ADR 0007), keeps the Waveform in app data as given, and marks the Version so that no probe and no Waveform job runs over it.

The reasons to move:

- A `deliver.json` is a foreign file in the clients' folders: it shows up in Files, on every sync client and in every download of the folder, and means nothing to anyone but Deliver.
- App data is written by Deliver only, in the spirit of ADR 0002: Files holds the media, Deliver holds what it derives. A request to Deliver's API is checked like every other one (write access on the file) and lands where Deliver keeps its media.
- A file of up to 5 MiB that anyone with write access could write had to be re-read and re-checked on every change to it, and an entry over the limits fell back to probing without telling anyone. A request over the limits answers 400 to the tool that sent it.
- The tool enables each file anyway and has the Version id from that answer, so one more request per file, right after, is all it takes.

## Considered Options

- Keep the file in the folder (ADR 0005): no extra request, but every cost above.

## Consequences

- App data was disposable (stories 79 and 81) and still is, except a Sidecar Waveform: it cannot be made again without the tool, so "regenerate" and `occ deliver:regenerate` keep it and delete the other derived media.
- Deleting the file, or taking it out of Deliver, deletes the Version and its Sidecar data with it.
- Sending a Sidecar again replaces it, so a re-delivery sends it again. Deliver does not react to a file written again in place today, neither probing it again nor rebuilding its derived media, so a file rewritten by someone else keeps the Sidecar's start, duration and Waveform until the tool sends a new one.
- A server without ffmpeg has no failed job for a file with a Sidecar, because its pending jobs are dropped when the Sidecar arrives.
- The Sidecar describes audio files only; it is a contract with reaper-deliver through the API and changes only compatibly.
- A Take Folder (not built yet) will be marked through Deliver's API too, not by a file in the folder.
- ADR 0005 is superseded in where the Sidecar lives and how it arrives.
