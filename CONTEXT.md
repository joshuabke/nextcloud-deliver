# Deliver

Video review inside Nextcloud: editors put cuts in Files, team members and external reviewers leave frame-accurate comments, and the editor takes those comments back into the NLE.

## Language

### Content

**Project**:
The folder in Nextcloud Files that holds a review workspace. It comes into being with the first Asset enabled inside it and carries the settings its Assets share. Files remains the source of truth for its contents.
_Avoid_: Library, workspace, space

**Auto Intake**:
A Project setting that makes every media file in the folder an Asset, including files that arrive later. Off by default: without it, a Member enables files one by one.
_Avoid_: Watch mode, auto scan, sync

**Asset**:
A video, audio or picture file inside a Project that has been enabled for review, by a Member or by Auto Intake. A single Asset may have several Versions. A Take is not an Asset.
_Avoid_: Video, clip, item, media

**Still**:
An Asset that is a picture (PNG, JPEG, WebP, GIF, AVIF). It has one Frame, so every Comment anchors to Frame 0 and Drawings do the pointing; no timecode, no derived media.
_Avoid_: Image asset, photo

**Version**:
One concrete file that represents one iteration of an Asset, carrying a Version Number chosen by a Member. Comments belong to a Version, never to the Asset as a whole.
_Avoid_: Revision, cut, upload

**Version Number**:
The integer a Member assigns to a Version, unique within its Version Stack. Suggested from the filename, never enforced by it.
_Avoid_: Revision number, iteration

**Version Stack**:
The ordered set of Versions belonging to one Asset, newest on top.
_Avoid_: History

### Review

**Comment**:
A note anchored to a Frame or a Range on one Version. Has an author, may have Replies, and can be Resolved.
_Avoid_: Note, annotation, marker (marker is an export term)

**Frame**:
The exact picture a Comment points to, expressed as a frame index at the Version's frame rate. An audio-only Version counts in milliseconds, so there a Frame is a millisecond. Seconds are derived, never stored as the anchor.
_Avoid_: Timestamp, time, position

**Range**:
A Comment anchor spanning an in Frame and an out Frame, inclusive.
_Avoid_: Region, selection, span

**Reply**:
A Comment nested under another Comment. Replies share the parent's anchor and cannot be nested further.
_Avoid_: Thread, child comment

**Resolved**:
A state on a top-level Comment meaning the editor considers it handled. Replies are not resolved individually.
_Avoid_: Done, closed, completed

**Drawing**:
Pen strokes, arrows and boxes on the Frame a Comment anchors to, in coordinates across the picture; shown whenever the player stands still on that Comment.
_Avoid_: Annotation (in the UI), sketch, markup

**Mention**:
A Member named in a Comment with `@`, who is notified even from a muted Project. Reviewers can be read but not mentioned, as they have no account.
_Avoid_: Tag, ping

**Watermark**:
The Reviewer's name and the date, repeated across the picture on a Share Link that asks for it. An overlay in the player, not burned into the media.
_Avoid_: Stamp, overlay (alone)

**Due Date**:
The calendar day an Asset should be through by. Members are reminded the day before and on the day, unless its newest Version is approved with nobody asking for changes.
_Avoid_: Deadline

**Attachment**:
A file added to a Comment, up to five of 25 MB. It lives in the Project folder under `.deliver-attachments/<Comment id>/`, is never an Asset, and goes with its Comment.
_Avoid_: Upload, file (alone)

**Reaction**:
One person's emoji on a Comment or Reply, from a small fixed set; agreement without a Reply.
_Avoid_: Like, vote

**Approval**:
One person's decision on a Version: approved, or changes requested. Whoever may comment decides; a decision can be changed or taken back.
_Avoid_: Sign-off, status, vote

### People

**Member**:
A Nextcloud user who can reach the Project folder through Files permissions.
_Avoid_: Owner (except for the folder's actual owner), collaborator, team

**Reviewer**:
Anyone who reaches a Version through a Share Link instead of Files permissions, identified by a self-given name (prefilled from their account if they happen to be logged in). Reviewers only ever touch their own Comments.
_Avoid_: Guest, anonymous user, client, external user

**Share Link**:
A Nextcloud link share with Deliver's review flag switched on: it contains at least one Asset and shows a Review button. Deliver owns no link type of its own; password, expiry and download permission stay share properties, and a link without the flag stays an ordinary share.
_Avoid_: Review Link, Deliver link, token link

**Personal Link**:
A Share Link URL carrying a Reviewer's own key, so that whoever opens it is that Reviewer, forever, on any device. Issued by a Member as an invitation or shown to a Reviewer after they name themselves.
_Avoid_: Invite link, magic link, session

**Unseen**:
A Comment or Reply the current person has not yet had on screen since it was written. Tracked per person per Version.
_Avoid_: New, unread (unread is for notifications)

### Takes

**Take**:
One recorded pass over a passage of a work, delivered as a file inside a Take Folder. Not an Asset: it has Comments but no Versions, and opens only in the Take comparison. Its start timecode is its position on the recording session's timeline, so the same time on two Takes is the same musical point. Named after its recording pass.
_Avoid_: Recording, pass, REAPER take (an alternative inside a REAPER media item, unrelated)

**Take Folder**:
A folder inside a Project marked as holding the Takes of one work, over which Deliver offers the Take comparison. A Project may hold several, usually one per work.
_Avoid_: Take set, take list, session

**Session Time**:
A point on the recording session's timeline, shown as `m:ss.mmm`. A Take's start timecode is its Session Time, so equal Session Time on two Takes is the same musical place.
_Avoid_: Position, timestamp, "Stelle" (that is the place in the music, which Session Time only stands for)

### Derived Media

**Proxy**:
A browser-playable rendition of a Version generated by Deliver, matching the source frame rate exactly so Frame anchors stay valid.
_Avoid_: Transcode, preview, rendition

**Thumbnail Strip**:
A grid of small frames sampled along a Version, used for hover previews on the timeline.
_Avoid_: Sprite, scrubber, filmstrip

**Waveform**:
Precomputed audio peaks of a Version, drawn under the timeline; the primary visual for audio-only Assets.
_Avoid_: Peaks, audio graph

**Missing**:
The state of a Version whose file has left the Project folder or gone to trash. Comments stay until the file is permanently deleted or a Member removes the Version.
_Avoid_: Orphaned, broken, deleted

### Delivery

**Export**:
A file generated from a Version's Comments for import into an editing application, such as an EDL.
_Avoid_: Download, report

**Delivery**:
One run of an editing application's Deliver action that puts new Versions or Takes into a Project, together with their Sidecar. Several works can go out in one Delivery.
_Avoid_: Publish, release, upload (and never Export, which is Comments going the other way)

**Sidecar**:
A `deliver.json` file in a Project folder, written by the delivering tool, that supplies start timecodes and Waveforms for the files beside it and marks the folder as a Take Folder when it holds Takes. Lets Deliver work fully without ffmpeg.
_Avoid_: Manifest, metadata file

## German

The German translation (`l10n/de` with "du", `l10n/de_DE` with "Sie") uses these terms. The trade words of post-production stay English.

| Term | German |
| --- | --- |
| Project | Projekt |
| Auto Intake | Automatische Aufnahme |
| Asset | Asset |
| Version, Version Number, Version Stack | Version, Versionsnummer, Versionsstapel |
| Comment, Reply | Kommentar, Antwort |
| Frame, Range | Frame, Bereich |
| Resolved (and its opposite) | Erledigt (Offen) |
| Member, Reviewer | Mitglied, Reviewer |
| Share Link, Personal Link | Freigabelink, Persönlicher Link |
| Unseen | Ungesehen |
| Proxy, Thumbnail Strip, Waveform | Proxy, Vorschauleiste, Wellenform |
| Missing | Fehlt |
| Export | Export |
| Delivery, Sidecar | Delivery, Sidecar |
| Take, Take Folder, Session Time | Take, Take-Ordner, Session-Zeit (never „Aufnahme“, which is Auto Intake) |
| Drawing | Zeichnung |
| Reaction | Reaktion |
| Mention | Erwähnung |
| Attachment | Anhang |
| Due Date | Fälligkeitsdatum |
| Watermark | Wasserzeichen |
| Still | Standbild |
| Approval (approved, changes requested) | Abnahme (abgenommen, Änderungen gewünscht) |
