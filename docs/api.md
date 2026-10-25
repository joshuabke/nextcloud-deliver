# API

OCS, under `/ocs/v2.php/apps/deliver/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | The Projects the user sees: a Folder Project whose folder they reach, one they made, one with a file they can open; and No Project (`id` 0, `none`) while it holds something of theirs |
| POST | `/projects` `{folderId, autoIntake}` or `{name}` | Turn a folder into a Folder Project, or make a Project by name |
| GET | `/folders/{folderId}/project` | The Folder Project of a folder, or 404 |
| GET | `/projects/{id}` | Project with the Assets the user can open; Auto Intake looks at the folder first. `/projects/0` is the user's No Project |
| PUT | `/projects/{id}` `{autoIntake, allowOlder, fpsNum, fpsDen, timecodeMode, name}` | Project settings, each field optional; `autoIntake` only for a Folder Project, `name` only for any other |
| PUT | `/projects/{id}/mute` `{muted}` | Mute or unmute the Project's notifications for oneself; 0 mutes No Project |
| DELETE | `/projects/{id}` | Remove the Project; its Assets go to No Project, files stay untouched |
| GET | `/files/{fileId}/asset` | The Asset of a file with its Project, or 404; `waveformFromBrowser` says the browser that uploaded the audio should decode its Waveform and hand it in (no ffmpeg, no Waveform yet, no WAV) |
| POST | `/assets` `{fileId, projectId, assetId}` | Enable one media file for review: into the Project given, 0 for No Project, or without one the Folder Project above it, else No Project; with `assetId`, as the next Version of that Asset of the same kind of media, a file already in review moving over |
| PUT | `/assets/{id}/project` `{projectId}` | Put an Asset into another Project, or 0 for No Project; no file moves |
| DELETE | `/assets/{id}` | Take a file out of Deliver, the file stays |
| DELETE | `/assets/{id}/files` | Delete an Asset with its files: they go to the trash of Files, the Asset with its review data at once |
| GET | `/versions/{id}/members` | Who can be @mentioned on a Version: whoever can open its file |
| GET | `/versions/{id}` | Project, Asset and Version Stack for the Review view |
| PUT | `/versions/{id}` `{number, autoStacked}` | Set the Version Number, or take note of an automatic stack |
| POST | `/versions/{id}/stack` `{assetId, number}` | Stack a Version onto another Asset |
| POST | `/versions/{id}/unstack` | Take a Version out of its Stack, which is also the undo |
| POST | `/versions/{id}/regenerate` | Delete the Version's derived media and queue it again |
| POST | `/versions/{id}/waveform` `{peaks, durationFrames}` | Hand in a Waveform (1 to 2000 peaks from 0 to 1) and the duration in Frames, for audio milliseconds, also before the probe ran; 409 once the Version has one or the server is making one, which then replaces it (ADR 0012) |
| GET | `/admin/settings` | Pipeline settings and status, admins only |
| PUT | `/admin/settings` `{ffmpegPath, ffprobePath, maxJobs, maxHeight, thumbCap, hwEncoder, hwDevice, extraArgs, projectFolder, attachmentLimit}` | Save and test the encoder, admins only; `attachmentLimit` in MB per person and Version |
| GET | `/apps/deliver/versions/{id}/export/{format}` `?unresolvedOnly=1&zeroBased=1` | The Comments as `edl` (DaVinci Resolve markers), `fcpxml` (FCP7 XML, Premiere Pro), `fcpx` (FCPXML, Final Cut Pro) or `csv`, and for audio as `wav` (embedded markers), `midi` (marker meta events) or `reaper` (Region/Marker Manager CSV); needs write access |
| POST | `/apps/deliver/versions/{id}/export/ableton` (multipart `set`) | An Ableton Live Set back with the Comments as locators |
| GET | `/apps/deliver/versions/{id}/media/{kind}` | Proxy, Thumbnail Strip, its index or the Waveform, with byte ranges |
| GET | `/versions/{id}/comments` | Comments of a Version, Frame order |
| POST | `/versions/{id}/comments` `{inFrame, outFrame, body, parentId}` | Comment on a Frame or a Range, or a Reply |
| GET | `/versions/{id}/changes?since=` | What changed, plus the ids that still exist |
| POST | `/versions/{id}/seen` `{at}` | Move the Unseen mark forward |
| PUT | `/comments/{id}` `{body}` | Edit one's own Comment |
| DELETE | `/comments/{id}` | Remove a Comment, with its Replies |
| PUT | `/comments/{id}/resolved` `{resolved}` | Resolve or unresolve, needs write access |
| GET | `/projects/{id}/links` | `{links, reviewers, canMail}`: my Review Links of the Project, or of No Project for id 0, each `live` when neither paused nor expired and with `assetName` when it shows one Asset, and every Reviewer of mine on the Project, on a link or not, with `links`: for each link they are on, their own `rights` there and their Personal Link through it (`url`, null while the link is not live), and `inContacts` (null without an address) |
| POST | `/projects/{id}/links` `{assetIds}` | A Review Link (ADRs 0010 and 0011), live and showing the whole Project, or only the Assets given; on No Project (id 0) `assetIds` is required |
| POST | `/projects/{id}/invitations` `{name, email, sendMail, message, assetIds, canComment, allowOlder, watermark, canDownload, latestOnly}` | Invite one person on a Review Link of their own, the whole Project or the Assets given (required on No Project); `{link, reviewer}` with the `key` of their Personal Link through it; the new link is live, and none is left when the invitation is refused |
| PUT | `/links/{id}` `{review, canComment, allowOlder, watermark, canDownload, latestOnly, label, description, password, expireDate, assetIds}` | Change a Review Link; `''` removes password, expiry or description, `assetIds: null` shows the whole Project again (not on No Project); `review: false` pauses it |
| DELETE | `/links/{id}` | Delete a Review Link |
| GET/POST | `/links/{id}/reviewers` | The Reviewers on it, with their Personal Links and their own `rights` on it; invite one `{name, email}`, an address the Project knows putting that Reviewer on it; the answer carries the `key` of the Personal Link through it, one of its own |
| GET | `/links/{id}/activity` | Who opened the link, watched or downloaded which Version, newest first |
| PUT | `/reviewers/{id}` `{name, email, mailReplies, mailComments, mailVersions}` | Edit a Reviewer of mine; 409 for an address another Reviewer of the Project has |
| PUT | `/reviewers/{id}/rights` `{token, rights: {canComment, allowOlder, watermark}}` | Their own rights on one link they are on, null each to leave it to the link; 404 for a link they are not on |
| POST | `/reviewers/{id}/links` `{token}` | Put a Reviewer on another of my links of their Project: 201 `{key, link}`, their Personal Link through it |
| DELETE | `/reviewers/{id}/links/{token}` | Take a Reviewer off one link; their Personal Link through it stops working, their other links stay |
| POST | `/reviewers/{id}/key` | New keys on every link they are on; the old Personal Links stop working |
| DELETE | `/reviewers/{id}` | Remove a Reviewer from the Project: off every link, their Personal Links stop working, their Comments stay |
| POST | `/reviewers/{id}/contact` | Save a Reviewer to my address book: 201 `{saved: true}`, or 200 `{saved: false}` when the address is in one of my address books already |
| GET | `/contacts?search=` | People of my own and shared address books whose name or address matches, `{name, email, photo}` per address, `photo` the CardDAV URL of their picture or null; never the instance's users |
| GET/PUT | `/settings` `{addressBook}` | My Deliver settings: the address book Reviewers are saved to, of `addressBooks` I can write to |

Rights follow each Version's file (ADR 0009): read access views and comments, write access manages. Missing write access answers 403; a request that clashes with the current state (a nested Folder Project, a taken Version Number, an older Version closed for Comments) answers 409.

A Personal Link is the Review Link's URL plus the key of that Reviewer on that link, `/s/{token}?r={key}`; each link a Reviewer is on has a key of its own (ADR 0014). Opening it stores the key in a cookie for that link, so the browser keeps the identity there.

Reviewers never touch OCS. Their surface hangs off the token of a Review Link, needs no account, and is checked by the public-share middleware before Deliver sees it:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/apps/deliver/s/{token}` | The review page: a link with one Asset opens it, with more a grid of them under the link's description |
| GET | `/apps/deliver/s/{token}/versions/{versionId}` | The review page on one Version |
| GET | `/apps/deliver/s/{token}/api/context` | Project settings, Asset and Version Stack behind the link |
| GET | `/apps/deliver/s/{token}/api/assets` | What the link shows, for the grid |
| GET | `/apps/deliver/s/{token}/preview?fileId=&x=&y=` | The still of a file behind the link |
| GET | `/apps/deliver/s/{token}/download` `?assetIds=1,2` | The newest Version of every Asset the link shows, or of those given, as one ZIP, where the link allows downloads |
| GET | `/apps/deliver/s/{token}/media/{versionId}/{kind}` | Derived media, or `original` where downloads are allowed or no Proxy is made; `?download=1` downloads it where both the link and the Member's own access allow downloads, and notes that in the link's activity |
| POST | `/apps/deliver/s/{token}/api/reviewer` `{name, email}` | Name yourself; the answer carries the Personal Link through this link. An address the Project knows answers 202 and mails that Reviewer their Personal Link through it instead |
| GET/POST | `/apps/deliver/s/{token}/api/versions/{id}/comments` | Read and write Comments as a Reviewer |
| PUT/DELETE | `/apps/deliver/s/{token}/api/comments/{id}` | Change or remove one's own Comment |

