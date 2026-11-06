---
status: accepted
---

# Proxies made by hand and captions are uploaded through Deliver into app data

Editors often render a Proxy as a second job in their editing software, and captions come as `.srt` or `.vtt` files from the same edit. Both belong to a Version, not to the folder: like every derived media they live in the Version's app data (ADR 0003), never in the Project folder. So a Member with Manage uploads them through Deliver, from the Version's menu ("Upload Proxy…", "Add captions…"): the file goes up as a hidden upload next to the Version's file, as the browser's Proxy does (ADR 0019), the server checks it, keeps it in app data and deletes the upload. Tools such as reaper-deliver use the same calls: `POST /versions/{id}/proxy {fileId}`, which now takes a Proxy with ffmpeg too, and `POST /versions/{id}/captions {fileId, language}`.

A Proxy handed in has to keep the rules of a Proxy from the browser: H.264/AAC MP4 that browsers play, sound where the original has it, the original's Frames at its rate, at most the Proxy resolution and below the Proxy bitrate threshold. One that breaks them is not taken, and the uploader is told why. It is taken only for a Version that gets a Proxy (ADR 0019); for any other the answer is "This Version plays without a Proxy".

## Considered options

- A sidecar next to the master, paired by name (`cut_v3.mov` with `cut_v3.proxy.mp4` or `cut_v3.srt`): upload and sync clients would need nothing new, but the folder fills with files Deliver owns, Auto Intake and stacking must skip `*.proxy.*`, and renaming, moving or deleting either file breaks the pair in ways Deliver can only guess at. Rejected.
- Taking a Proxy handed in only without ffmpeg, as for the browser's: the editor's render is often better than ffmpeg's, and costs the server nothing. Rejected.

## Consequences

- The server marks a Proxy handed in (`proxy_handed_in` on the Version). Such a Proxy replaces one ffmpeg made, withdraws a job making one (which looks before it writes), and keeps ffmpeg from making another, a retry of a failed job included. It plays as "Proxy" in the quality menu like any.
- A Member with Manage can remove a Proxy handed in (`DELETE /versions/{id}/proxy`); then the normal path takes over: with ffmpeg its Proxy is queued at once, without the Asset card offers the browser's again. A Proxy ffmpeg made is not removed this way, it would come right back.
- A Proxy from the browser is handed in the same way, marked as a conversion, and counts as handed in too. A conversion never replaces a Proxy that is there, one by hand above all: a tab converting while one comes by hand is told to stop. Only a conversion shows as failed when it is refused; a Proxy by hand refused changes nothing, also not for a browser converting meanwhile.
- "Regenerate" and a file written again drop a Proxy handed in with the rest of the derived media, and its mark. Captions survive both, as they are kept apart from what regeneration deletes.
- File names get no special treatment: an upload named `cut_v3.proxy.mp4` is a Version like any other.
- This supersedes ADR 0019 where its hand-in takes a Proxy only without ffmpeg and only while the Version has none.
