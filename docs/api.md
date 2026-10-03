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
| GET | `/files/{fileId}/asset` | The Asset of a file with its Project, or 404 |
| POST | `/assets` `{fileId, projectId}` | Enable one media file for review: into the Project given, 0 for No Project, or without one the Folder Project above it, else No Project |
| PUT | `/assets/{id}/project` `{projectId}` | Put an Asset into another Project, or 0 for No Project; no file moves |
| DELETE | `/assets/{id}` | Take a file out of Deliver, the file stays |
| GET | `/versions/{id}/members` | Who can be @mentioned on a Version: whoever can open its file |
| GET | `/versions/{id}` | Project, Asset and Version Stack for the Review view |
| PUT | `/versions/{id}` `{number, autoStacked}` | Set the Version Number, or take note of an automatic stack |
| POST | `/versions/{id}/stack` `{assetId, number}` | Stack a Version onto another Asset |
| POST | `/versions/{id}/unstack` | Take a Version out of its Stack, which is also the undo |
| POST | `/versions/{id}/regenerate` | Delete the Version's derived media and queue it again; a Sidecar's Waveform stays |
| PUT | `/versions/{id}/sidecar` `{start, duration, waveform: {rate, peaks}}` | The Sidecar of an audio file from the tool that delivered it (ADR 0012): Session Time of the first sample and duration in seconds, a Waveform of 1 to 100 peaks a second, each 0 to 1, at most ceil(duration × rate) + 1 of them; stands over any probe, replaces an earlier one, needs write access, 400 outside the limits |
| GET | `/admin/settings` | Pipeline settings and status, admins only |
| PUT | `/admin/settings` `{ffmpegPath, ffprobePath, maxJobs, maxHeight, thumbCap, hwEncoder, hwDevice, extraArgs}` | Save and test the encoder, admins only |
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
| GET | `/projects/{id}/links` | `{links, reviewers}`: my Project Links of the Project, or of No Project for id 0, and my Reviewers who came by any of them, each with a Personal Link through every live one, keyed by token |
| POST | `/projects/{id}/links` `{assetIds}` | A Project Link (ADRs 0010 and 0011), live and showing the whole Project, or only the Assets given; on No Project (id 0) `assetIds` is required |
| PUT | `/links/{id}` `{review, canComment, allowOlder, watermark, canDownload, latestOnly, label, description, password, expireDate, assetIds}` | Change a Project Link; `''` removes password, expiry or description, `assetIds: null` shows the whole Project again (not on No Project); `review: false` pauses it |
| DELETE | `/links/{id}` | Delete a Project Link |
| GET/POST | `/links/{id}/reviewers` | Its Reviewers with Personal Links; invite one `{name, email}` |
| GET | `/links/{id}/activity` | Who opened the link, watched or downloaded which Version, newest first |
| PUT | `/reviewers/{id}` `{name, email, mailReplies, mailComments, mailVersions, rights}` | Edit a Reviewer of mine, with their own rights over the link's |
| POST | `/reviewers/{id}/key` | A new Personal Link; the old ones stop working |
| DELETE | `/reviewers/{id}` | Remove a Reviewer: their Personal Links stop working, their Comments stay |

Rights follow each Version's file (ADR 0009): read access views and comments, write access manages. Missing write access answers 403; a request that clashes with the current state (a nested Folder Project, a taken Version Number, an older Version closed for Comments) answers 409.

A Personal Link is the Project Link's URL plus the Reviewer's key, `/s/{token}?r={key}`. Opening it stores the key in a cookie for that link, so the browser keeps the identity.

Reviewers never touch OCS. Their surface hangs off the token of a Project Link, needs no account, and is checked by the public-share middleware before Deliver sees it:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/apps/deliver/s/{token}` | The review page: a link with one Asset opens it, with more a grid of them under the link's description |
| GET | `/apps/deliver/s/{token}/versions/{versionId}` | The review page on one Version |
| GET | `/apps/deliver/s/{token}/api/context` | Project settings, Asset and Version Stack behind the link |
| GET | `/apps/deliver/s/{token}/api/assets` | What the link shows, for the grid |
| GET | `/apps/deliver/s/{token}/preview?fileId=&x=&y=` | The still of a file behind the link |
| GET | `/apps/deliver/s/{token}/download` `?assetIds=1,2` | The newest Version of every Asset the link shows, or of those given, as one ZIP, where the link allows downloads |
| GET | `/apps/deliver/s/{token}/media/{versionId}/{kind}` | Derived media, or `original` where the link allows downloads or no Proxy is made; `?download=1` downloads it and notes that in the link's activity |
| POST | `/apps/deliver/s/{token}/api/reviewer` `{name, email}` | Name yourself; the answer carries the Personal Link |
| GET/POST | `/apps/deliver/s/{token}/api/versions/{id}/comments` | Read and write Comments as a Reviewer |
| PUT/DELETE | `/apps/deliver/s/{token}/api/comments/{id}` | Change or remove one's own Comment |

