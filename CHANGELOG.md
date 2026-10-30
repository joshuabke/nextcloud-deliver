# Changelog

## Unreleased

### Added
- Show who delivered each Version, and filter by what you delivered.
- Lock files with Comments or Approvals against overwriting, renaming and deleting outside Deliver, with a Project setting.
- Mark Comments made before an overwrite of their file and notify the Members.
- Add `POST /versions/{id}/replace` for delivering tools to replace a Version's file, Comments kept.
- Show who made a Review Link in the navigation.
- Set what each Member may do in a Project: None, View, Comment or Manage, with Share and Approve, defaulting to what Files allows.
- Choose what someone newly given access in Files starts with: as in Files, View or None; it applies only to people who come after the change.
- Let someone new in a group start where the group stands in the Project.
- List a Project's Members, people and groups, with `GET /projects/{id}/members`, and set them with `PUT` and `DELETE`.
- List the groups of a group folder as Members of its Project.

### Changed
- Rename files through Deliver instead of WebDAV, for Members with Manage and write access in Files.
- Let Members with Share see and manage all of a Project's Review Links and Reviewers, whoever made them.
- Make an email address one Reviewer per Project, whoever invited them; merge Reviewers invited twice.
- Stop a merged Reviewer's Personal Link on a link where the Reviewer they merged into was on it too.
- Check on every list whether a Reviewer is in the contacts of whoever looks, instead of once per Reviewer.
- Stop read access in Files from approving Versions, unless a Member with Manage allows it.
- Let only Members with Comment edit and delete their own Comments.
- Keep a Project, its Versions, notifications and Mentions from Members with None; say in the Files sidebar only that the file is in review.
- Treat a Member with None as a Reviewer on a Review Link.

## 0.9.7 – 2026-10-27

### Added
- Let `POST /assets` take `newAsset: true` to enable a file as an Asset of its own instead of stacking it by name.
- Copy a Reviewer's Personal Link from their menu.

### Changed
- Look up the Version files of the Project list folder by folder instead of one by one.

### Fixed
- Show names with & or ' as they are instead of as HTML entities.
- Check for ffmpeg on the admin page instead of on every page load.

## 0.9.6 – 2026-10-26

### Added
- Keep deleted Projects under Deleted Projects, to restore or delete for good; after 30 days, or as many as the admin sets, they go for good with all their data. The files stay.
- Offer a Deleted Project back when its folder or one of its files is wanted in review again.

### Changed
- Delete a Project instead of moving its Assets to No Project.
- Say in a Review Link's settings what hiding downloads and the Watermark do.
- Let ffmpeg and ffprobe read only local files in the formats Deliver takes.
- Leave playlists (M3U, PLS) out of review.
- Refuse Ableton Live Sets that unpack to more than 100 MB.
- Limit attachments to 20 MB per person and Version in all, adjustable in the admin settings.
- Improve code readability.

### Fixed
- Close a Version to Members who cannot open its file, also when they open another Version of its Stack.
- Keep Comments and Reviewer names from starting a spreadsheet formula in the CSV export.
- Refuse inviting or renaming a Reviewer to the name of a Reviewer who is on no link of the Project.
- Title a Review Link on one Asset by its name in the Files sidebar of a Folder Project.
- Show an expired Review Link as expired in its settings.
- Leave the Project view once the Project is deleted from its settings.
- Show dates for languages with a region, such as German (formal), instead of failing.
- Dismiss notifications about a Version once it is deleted.
- Keep files shared without downloads out of a Review Link's downloads and the WAV export, and off Review Links where Nextcloud hides their content.

## 0.9.5 – 2026-10-24

### Added
- Suggest the Project's Reviewers and the Member's contacts, with their pictures, when inviting a Reviewer.
- Add "Save to Contacts" to a Reviewer's menu.
- Add Deliver settings with the address book Reviewers are saved to.
- Add a plus next to "Reviewers" that invites one person on a Review Link of their own.
- Put a Reviewer on another Review Link, or take them off one.
- Show Reviewers with their initials in the navigation; under a link, open their rights on it.

### Changed
- Move "Create Review Link" to a plus next to "Links".
- Title Review Links by what they show.
- Make each email address one Reviewer per Project.
- Give each Personal Link a key of its own, which opens only its Review Link. Personal Links that 0.9.2 mailed for a link the Reviewer never opened stop working; put them on that link again.
- Move a Reviewer's own rights to each Review Link they are on.
- List every Reviewer of the Project, on a link or not.
- Leave name and address of a Reviewer on several links to the Member who invited them.
- Rename Project Links to Review Links.

### Fixed
- Say whether the name or the address is taken when a Reviewer names themselves.
- Treat expired Review Links as paused in the navigation.

## 0.9.2 – 2026-10-22

- Reviewers belong to the Project of the link they came by: a link's settings list only them, and their Personal Link and mails stay within that Project. Someone who already reviewed several Projects keeps the first; invite them again on the others.

## 0.9.1 – 2026-10-22

- Fix cron jobs being set as non-time-critical.
- Fix icon alignment on the minimised upload card.

## 0.9.0 – 2026-10-21

### Added
- Uploads dialog: one queue for every upload in Deliver, one file at a time, keeps running across views.
- "Continue in the background": the dialog shrinks to a card (a bar on phones).
- Chunked uploads: pause while offline, retry failed chunks, resume after a reload.
- Progress with speed and time left, then the state of Waveform, Proxy and Thumbnail Strip.
- Uploads show in every open tab and can be cancelled from any of them.
- Without ffmpeg, the uploading browser makes the Waveform during the upload.
- Formats list in the dialog: what plays directly, what needs ffmpeg.
- "Processing failed" on Asset cards; "Process again" in the Asset menu and the upload list.
- Select Asset cards: checkbox, Ctrl/Cmd-click, Shift-click, select all.
- Menu for selected Assets: Process again, Due Date, Move to Project, Remove, Delete.
- Delete an Asset: files of every Version go to the trash, the Asset goes with its review data. Missing Assets too.
- "New Project" creates a Project folder, under `/Deliver` or the place set in Administration → Deliver.
- API: `DELETE /assets/{id}/files`.

### Changed
- Click on a card selects it, double click opens the Review.
- Proxies are at least 720p.

### Fixed
- Phone: typing a Comment stops playback, and the anchor matches the Frame shown.

## 0.8.4 – 2026-10-13

- Every card has a "…" button beside its name, on every screen, that opens the same menu as a right click or a long press. A Project's settings moved from the gear into that menu.
- Asset cards show the Version, the Approval, the Comments and the runtime in the corners of their still, Missing or Processing in place of the runtime, when the newest Version arrived below the name, and the filename on hovering the name.
- Media files in a Folder Project that are not up for review have a menu of their own: add for review, add as a new Version of an Asset of the same kind, download, rename and show in Files. An Asset's menu can download and rename its newest Version's file too. Renaming keeps the extension, so a file never changes its kind.
- Removing an Asset keeps its files out of Auto Intake, also after a rename, a move inside the folder, an overwrite or switching Auto Intake off and on. They wait under "Not up for review" until someone adds them again. This works from the Files sidebar too, where "Review in Deliver" can now be switched off for a file in a folder on Auto Intake. "Take out of Deliver" is now "Remove from Project", or "Remove from Deliver" in No Project.
- A Project removed and made again from its folder gets its Assets back from No Project, with their Comments.
- Confirmations grow with their heading, so the German ones fit.
- API: `POST /assets` takes an `assetId` and adds the file as that Asset's next Version in one step.

## 0.8.3 – 2026-10-09

- Reviewers have their own menu under an avatar at the top of the review, as on Frame.io: change their name and address, choose what is mailed to them, switch between German and English, and end their session so the next person names themselves anew.
- Naming oneself with the name and address of an existing Reviewer mails that Reviewer their Personal Link, so they are back in the review from their mailbox. Two Reviewers may share a name; their avatars differ in colour. A Member's name stays taken, and invited or renamed Reviewers still need a name of their own.
- Mails to a Reviewer come in the language they review in.
- A new address given later gets the Personal Link by mail too.

## 0.8.2 – 2026-10-06

- A Reviewer who names themselves on a link with an email address gets their Personal Link by mail right away, instead of a notice to bookmark it.
- Inviting a Reviewer can mail them their Personal Link, under a message of your own; answers go to your address.
- Names in a review are unique: naming oneself, inviting and renaming refuse a name that a Member of the shared files or another Reviewer of the Project already has.
- Naming oneself on a link is rate limited, so that a link cannot be used to send mail to strangers in bulk.

## 0.8.1 – 2026-10-06

- Nextcloud 35 is supported.
- Deleting a Nextcloud account no longer leaves its Projects, links and Reviewers to the next account created under the same user id. A Folder Project passes to whoever owns the folder, other Projects are removed with their Assets kept in No Project, and the account's Comments and Approvals stay, under "Deleted user".
- The App Store page lists what Deliver does, in English and German.
- New screenshots, and a README with the features at a glance, a screenshot gallery and how Deliver fares with hosted Nextcloud providers.

## 0.8.0 – 2026-10-05

First release in the App Store, as a pre-release: try it on real projects, but keep your own backups and expect rough edges. Feedback goes to the GitHub issues.

- Enable a video, audio or image file for review from the Files sidebar, into a Project of your choice or none, or turn a whole folder into a Project that takes in every media file. Projects collect files from anywhere, and whoever can open a file sees its review. Files stays the source of truth: nothing is copied or moved, and a file written again in place keeps its Comments and is read again.
- Comments anchored to a Frame or a Range, with Replies, Drawings, Mentions, Reactions and Attachments, and Resolved once they are done.
- Version Stacks for the iterations of a cut, and two Versions side by side or under a wipe, playing in sync.
- Approvals: approve a Version or request changes, and everyone sees who decided what.
- Review for outsiders on Project Links, Deliver's own links for a whole Project or picked Assets, wherever the files lie, and for single files in No Project: password, expiry, pause, comments, download, only the newest Version, a description above a grid of the Assets with downloads one by one, as a ZIP of all or of those picked, and who opened, watched and downloaded what. Every Reviewer gets a Personal Link, their own rights and an optional Watermark with their name. A Member who opens a link sees a read-only preview of what Reviewers see, with the way into Deliver. Sharing in Files stays plain Nextcloud sharing.
- Due Dates with reminders, Unseen Comments, notifications and mail, and live updates without reloading.
- Export of the Comments as EDL, FCP7 XML, FCPXML or CSV, as markers for the editing application.
- Audio counts to the millisecond: shown as `m:ss.mmm`, switchable to timecode or frames at the Project's frame rate.
- Proxies, Thumbnail Strips and Waveforms when ffmpeg is installed; without it, browser-native files play as they are, MOV, MP4 and Broadcast WAV keep their frame rate and start timecode, an MP3, FLAC or M4A the start its delivering tool wrote into its tag, a FLAC its duration, WebM and MKV their frame rate, and audio still gets its Waveform.
- Scrub through a video by moving the mouse over its still, in Deliver and on a link's landing page; without ffmpeg on the server a frame of the video stands in for the still.
- Works on phones: the Review view, drawing with a finger and the Project list are made for small screens.
- Troubleshooting without a shell: setup checks on the admin overview, failed media jobs in the Nextcloud log and retried from Deliver's settings, and a support report to attach to an issue.
- English and German.
