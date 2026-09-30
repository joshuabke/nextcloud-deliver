# API

OCS, under `/ocs/v2.php/apps/deliver/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | Projects whose folder the user can reach |
| POST | `/projects` `{folderId}` | Turn a folder into a Project |
| GET | `/folders/{folderId}/project` | The Project of a folder, or 404 |
| GET | `/projects/{id}` | Project with its Asset tree; rescans the folder |
| PUT | `/projects/{id}` `{autoIntake, allowOlder, fpsNum, fpsDen, timecodeMode}` | Project settings, each field optional |
| PUT | `/projects/{id}/mute` `{muted}` | Mute or unmute the Project's notifications for oneself |
| DELETE | `/projects/{id}` | Remove the Project, files stay untouched |
| GET | `/files/{fileId}/asset` | The Asset of a file, or 404 |
| POST | `/assets` `{fileId}` | Enable one media file for review |
| DELETE | `/assets/{id}` | Take a file out of Deliver, the file stays |
| GET | `/versions/{id}` | Project, Asset and Version Stack for the Review view |
| PUT | `/versions/{id}` `{number, autoStacked}` | Set the Version Number, or take note of an automatic stack |
| POST | `/versions/{id}/stack` `{assetId, number}` | Stack a Version onto another Asset |
| POST | `/versions/{id}/unstack` | Take a Version out of its Stack, which is also the undo |
| POST | `/versions/{id}/regenerate` | Delete the Version's derived media and queue it again |
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
| GET | `/files/{fileId}/shares` | The Share Links of a file or folder, with Deliver's flags |
| POST | `/files/{fileId}/shares` | A Share Link with review already on |
| PUT | `/shares/{shareId}` `{review, canComment, allowOlder}` | Switch review on a Share Link and set its flags |
| GET | `/shares/{shareId}/reviewers` | The Project's Reviewers, each with a Personal Link through this share |
| POST | `/shares/{shareId}/reviewers` `{name, email}` | Invite a Reviewer; the answer carries the Personal Link |

Missing write access answers 403; a request that clashes with the current state (a nested Project, a taken Version Number, an older Version closed for Comments) answers 409.

A Personal Link is the share URL plus the Reviewer's key, `/s/{token}?r={key}`. Opening it stores the key in a cookie for that share, so the browser keeps the identity.

Reviewers never touch OCS. Their surface hangs off the share token, needs no account, and is checked by the public-share middleware before Deliver sees it:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/apps/deliver/s/{token}` | The review page; `?fileId=` opens a specific file |
| GET | `/apps/deliver/s/{token}/versions/{versionId}` | The review page on one Version |
| GET | `/apps/deliver/s/{token}/api/context` | Project settings, Asset and Version Stack behind the link |
| GET | `/apps/deliver/s/{token}/api/assets` | What the link shows, for the Review button in the file list |
| GET | `/apps/deliver/s/{token}/media/{versionId}/{kind}` | Derived media, or `original` where the share hides downloads and no Proxy is made |
| POST | `/apps/deliver/s/{token}/api/reviewer` `{name, email}` | Name yourself; the answer carries the Personal Link |
| GET/POST | `/apps/deliver/s/{token}/api/versions/{id}/comments` | Read and write Comments as a Reviewer |
| PUT/DELETE | `/apps/deliver/s/{token}/api/comments/{id}` | Change or remove one's own Comment |

