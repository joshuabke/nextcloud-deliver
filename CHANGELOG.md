# Changelog

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
