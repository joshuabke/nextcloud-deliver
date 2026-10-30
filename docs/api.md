# API

OCS, under `/ocs/v2.php/apps/deliver/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | The Projects the user sees: a Folder Project whose folder they reach, one they made, one with a file they can open; and No Project (`id` 0, `none`) while it holds something of theirs |
| POST | `/projects` `{folderId, autoIntake}` or `{name}` | Turn a folder into a Folder Project, or make a Project by name; 409 `{reason: deleted, projectId, projectName}` when a Deleted Project the user may change holds the folder, one inside it or one around it, a plain 409 for anyone else |
| GET | `/folders/{folderId}/project` | The Folder Project of a folder, or 404 |
| GET | `/projects/{id}` | Project with the Assets the user can open; Auto Intake looks at the folder first. `/projects/0` is the user's No Project |
| PUT | `/projects/{id}` `{autoIntake, allowOlder, lockFiles, fpsNum, fpsDen, timecodeMode, name, newcomers}` | Project settings, each field optional, for a Member with Manage; `autoIntake` only for a Folder Project, `name` only for any other; `newcomers` (`files`, `view`, `none`) is what someone newly given access in Files starts with: a change reaches only people who come after it: as it changes, Deliver notes everyone who is a Member then under the setting they came under, and makes no entry for anyone (ADR 0016); `lockFiles` (on unless switched off) locks the files of Versions with Comments or Approvals against overwriting, renaming and deleting outside Deliver (ADR 0018), and `lockAvailable` in the answer says whether Nextcloud can lock at all |
| GET | `/projects/{id}/members` | Everyone who can open one of the Project's files as Files grants it, for a Member with Manage: the owner first, then groups, then people. Each row: `type` (`user`, `group`), `id`, `name`, `owner`, `via` (the groups, `{id, name}`, Files gives a person access through), `stored` (what a Member with Manage set, `{level, share, approve}`, or null), the effective `level` (`none`, `view`, `comment`, `manage`), `share` and `approve`, and `canShare`, whether Files lets them reshare (always false for a group whose share does not allow resharing) |
| PUT | `/projects/{id}/members` `{type, principal, level, share, approve}` | Set a person or a group; the row as it is now. `view` and `none` carry no Approve, `none` no Share. 403 for the owner, and for Share or Approve the Member does not have themselves unless the other already has it; 400 for Share where Files lets them reshare nothing; 409 for the last Member with Manage of a Folder Project in a group folder |
| DELETE | `/projects/{id}/members?type=&principal=` | Take back what was set: they have what Files gives again; the row as it is now. Same refusals |
| PUT | `/projects/{id}/mute` `{muted}` | Mute or unmute the Project's notifications for oneself; 0 mutes No Project |
| DELETE | `/projects/{id}` | Delete the Project: it becomes a Deleted Project, whole (ADR 0015); 403 naming the Assets the user may not change but can open, and counting the others |
| GET | `/deleted-projects` | `{projects, days}`: the Deleted Projects the user may restore, each with `name`, `deletedAt`, `deletedBy` and `goesAt`, when it is deleted for good; `days` they are kept |
| POST | `/deleted-projects/{id}/restore` | Bring a Deleted Project back with everything whose file is still there, its Review Links as they were |
| DELETE | `/deleted-projects/{id}` | Delete a Deleted Project for good with all its data; files stay untouched |
| GET | `/files/{fileId}/asset` | The Asset of a file with its Project, or 404, or just `{restricted: true}` where the user has None in its Project; `waveformFromBrowser` says the browser that uploaded the audio should decode its Waveform and hand it in (no ffmpeg, no Waveform yet, no WAV) |
| POST | `/assets` `{fileId, projectId, assetId, newAsset}` | Enable one media file for review: into the Project given, 0 for No Project, or without one the Folder Project above it, else No Project; 409 `{reason: deleted, projectId, projectName}` when a Deleted Project the user may change holds the file or its folder, a plain 409 for anyone else; with `assetId`, as the next Version of that Asset of the same kind of media, a file already in review moving over; with `newAsset: true`, as a new Asset whatever its name, its Version Number still read from the name (`mix_v2.wav` is 2), a file already in a Stack leaving it (400 together with `assetId`) |
| PUT | `/assets/{id}/project` `{projectId}` | Put an Asset into another Project, or 0 for No Project; no file moves |
| DELETE | `/assets/{id}` | Take a file out of Deliver, the file stays |
| DELETE | `/assets/{id}/files` | Delete an Asset with its files: they go to the trash of Files, the Asset with its review data at once |
| POST | `/files/{fileId}/rename` `{name}` | Rename a file in its folder from inside Deliver's lock, which WebDAV cannot pass; 409 for a name the folder holds, 400 for an empty name or one with a slash |
| GET | `/versions/{id}/members` | Who can be @mentioned on a Version: whoever can open its file |
| GET | `/versions/{id}` | Project, Asset and Version Stack for the Review view |
| PUT | `/versions/{id}` `{number, autoStacked}` | Set the Version Number, or take note of an automatic stack |
| POST | `/versions/{id}/stack` `{assetId, number}` | Stack a Version onto another Asset |
| POST | `/versions/{id}/unstack` | Take a Version out of its Stack, which is also the undo |
| POST | `/versions/{id}/regenerate` | Delete the Version's derived media and queue it again |
| POST | `/versions/{id}/waveform` `{peaks, durationFrames}` | Hand in a Waveform (1 to 2000 peaks from 0 to 1) and the duration in Frames, for audio milliseconds, also before the probe ran; 409 once the Version has one or the server is making one, which then replaces it (ADR 0012) |
| POST | `/versions/{id}/replace` `{fileId, confirm}` | Replace the content of the Version's file with the file `fileId` and delete that file, keeping the Version's file id, so its Comments stay (spec: Delivering again); see below. 409 `{reason: confirm}` when the Version has Comments and `confirm` is not true, 400 for a file that is not next to the Version's file or is a Version itself, 403 without write access |
| GET | `/admin/settings` | Pipeline settings and status, admins only |
| PUT | `/admin/settings` `{ffmpegPath, ffprobePath, maxJobs, maxHeight, thumbCap, hwEncoder, hwDevice, extraArgs, projectFolder, attachmentLimit, deletedDays}` | Save and test the encoder, admins only; `attachmentLimit` in MB per person and Version; `deletedDays` how long Deleted Projects are kept, 1 to 365 |
| GET | `/apps/deliver/versions/{id}/export/{format}` `?unresolvedOnly=1&zeroBased=1` | The Comments as `edl` (DaVinci Resolve markers), `fcpxml` (FCP7 XML, Premiere Pro), `fcpx` (FCPXML, Final Cut Pro) or `csv`, and for audio as `wav` (embedded markers), `midi` (marker meta events) or `reaper` (Region/Marker Manager CSV); needs Manage |
| POST | `/apps/deliver/versions/{id}/export/ableton` (multipart `set`) | An Ableton Live Set back with the Comments as locators |
| GET | `/apps/deliver/versions/{id}/media/{kind}` | Proxy, Thumbnail Strip, its index or the Waveform, with byte ranges |
| GET | `/versions/{id}/comments` | Comments of a Version, Frame order |
| POST | `/versions/{id}/comments` `{inFrame, outFrame, body, parentId}` | Comment on a Frame or a Range, or a Reply |
| GET | `/versions/{id}/changes?since=` | What changed, plus the ids that still exist |
| POST | `/versions/{id}/seen` `{at}` | Move the Unseen mark forward |
| PUT | `/comments/{id}` `{body}` | Edit one's own Comment |
| DELETE | `/comments/{id}` | Remove a Comment, with its Replies |
| PUT | `/comments/{id}/resolved` `{resolved}` | Resolve or unresolve, needs Manage |
| PUT | `/versions/{id}/approval` `{status}` | Approve (`approved`), request changes (`changes`) or take the decision back (null); needs Approve |
| GET | `/projects/{id}/links` | `{links, reviewers, canMail}`: the Project's Review Links, every Member's, or my own on No Project for id 0, each `live` when neither paused nor expired, with `madeBy: {id, name}`, the Member who made it, and with `assetName` when it shows one Asset, and every Reviewer of the Project, whoever invited them, on a link or not, with `links`: for each link they are on, their own `rights` there and their Personal Link through it (`url`, null while the link is not live), and `inContacts`, whether their address is in my address books now (null without an address); 404 for a Deleted Project or one I do not see |
| POST | `/projects/{id}/links` `{assetIds}` | A Review Link (ADRs 0010 and 0011), live and showing the whole Project, or only the Assets given; on No Project (id 0) `assetIds` is required |
| POST | `/projects/{id}/invitations` `{name, email, sendMail, message, assetIds, canComment, allowOlder, watermark, canDownload, latestOnly}` | Invite one person on a Review Link of their own, the whole Project or the Assets given (required on No Project); `{link, reviewer}` with the `key` of their Personal Link through it; the new link is live, and none is left when the invitation is refused |
| PUT | `/links/{id}` `{review, canComment, allowOlder, watermark, canDownload, latestOnly, label, description, password, expireDate, assetIds}` | Change a Review Link; `''` removes password, expiry or description, `assetIds: null` shows the whole Project again (not on No Project); `review: false` pauses it |
| DELETE | `/links/{id}` | Delete a Review Link |
| GET/POST | `/links/{id}/reviewers` | The Reviewers on it, with their Personal Links and their own `rights` on it; invite one `{name, email}`, an address the Project knows putting that Reviewer on it; the answer carries the `key` of the Personal Link through it, one of its own |
| GET | `/links/{id}/activity` | Who opened the link, watched or downloaded which Version, newest first |
| PUT | `/reviewers/{id}` `{name, email, mailReplies, mailComments, mailVersions}` | Edit a Reviewer of the Project; 409 for an address another Reviewer of the Project has |
| PUT | `/reviewers/{id}/rights` `{token, rights: {canComment, allowOlder, watermark}}` | Their own rights on one link they are on, null each to leave it to the link; 404 for a link they are not on |
| POST | `/reviewers/{id}/links` `{token}` | Put a Reviewer on another link of their Project: 201 `{key, link}`, their Personal Link through it |
| DELETE | `/reviewers/{id}/links/{token}` | Take a Reviewer off one link; their Personal Link through it stops working, their other links stay |
| POST | `/reviewers/{id}/key` | New keys on every link they are on; the old Personal Links stop working |
| DELETE | `/reviewers/{id}` | Remove a Reviewer from the Project: off every link, their Personal Links stop working, their Comments stay |
| POST | `/reviewers/{id}/contact` | Save a Reviewer to my address book: 201 `{saved: true}`, or 200 `{saved: false}` when the address is in one of my address books already |
| GET | `/contacts?search=` | People of my own and shared address books whose name or address matches, `{name, email, photo}` per address, `photo` the CardDAV URL of their picture or null; never the instance's users |
| GET/PUT | `/settings` `{addressBook}` | My Deliver settings: the address book Reviewers are saved to, of `addressBooks` I can write to |

Which Assets a person sees follows each Version's file (ADR 0009); what they do with them is their Access level in the Project (ADR 0016): None answers 404 for the Project, its Versions and Comments as if they were not there, View reads, Comment also comments, Manage also runs the review, and Approve and Share are switches next to it. The Project and Version payloads carry the user's own `access: {level, share, approve}`, `manages` (Manage) and `filesWrite` (Files' write access to the folder or file, which uploading, renaming and deleting take on top of Manage); a Comments answer carries `canComment`, `canApprove`, `canEditOwn` and `canDeleteOwn` (whether they may edit and delete their own Comments: a Member with Comment, also on an older Version closed for new ones; a Reviewer edits only where their link lets them comment and deletes always). Missing rights answer 403; a request that clashes with the current state (a nested Folder Project, a taken Version Number, an older Version closed for Comments) answers 409.

Review Links and Reviewers belong to the Project (ADR 0017): every Member with Share (ADR 0016) may call the link and Reviewer endpoints above on all of them, whoever made the link or invited the Reviewer; 403 without Share, 404 for a Project they do not see. A link's `madeBy` says who made it, and what it shows stays bound to what that Member may reshare (ADR 0010). On No Project they are the Member's own: another Member gets 403. An email address is one Reviewer per Project, so inviting it on a second link, by whichever Member, puts the same Reviewer on it.

Every Version a Member gets, in a Project's Assets, in the Review view's Version Stack and in the Files sidebar's Asset, carries `deliveredBy`: `{type, id, name}` of the account whose request wrote its file or enabled it for review, or null when nobody's did. Reviewers are not told.

A Version with Comments or Approvals has its file locked by Deliver (ADR 0018): WebDAV `PUT`, `MOVE` and `DELETE` on it answer 423 for everybody, and Files shows it as locked by Deliver. A delivering tool therefore replaces a Version's file in three steps. It reads the Version's Comments first and asks its user when there are any, `GET /versions/{id}/comments`. It uploads the new content as it uploads any file (chunked where it does), but to a temporary file next to the Version's file, named without a media extension, such as `.deliver-replace-<random>`, so that Auto Intake ignores it. It then calls `POST /versions/{id}/replace {fileId: <the temporary file's id>, confirm: <true once the user agreed>}`. Deliver streams the content into the Version's file inside its lock, keeps its file id, deletes the temporary file and reads the file again as on intake, so the tool hands in a Waveform afterwards as for any delivery. The Version's `overwrittenAt` (unix seconds, null if never) is set when it had Comments, and the Comments made until then show as made before the overwrite. Nobody is notified of a confirmed replace; an overwrite that is not one, where there is no lock (files_lock missing, the Project's switch off, or the owner lifted it in Files), is taken as it comes, sets `overwrittenAt` and notifies the Version's Members. There is no general unlock in the API.

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

