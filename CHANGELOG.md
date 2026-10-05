# Changelog

## 0.9.7 – unreleased

First release in the App Store, as a beta: try it on real projects, but keep your own backups and expect rough edges. Feedback goes to the GitHub issues.

- Enable a video, audio or image file for review from the Files sidebar, into a Project of your choice or none, or turn a whole folder into a Project that takes in every media file. Projects collect files from anywhere, and whoever can open a file sees its review. Files stays the source of truth: nothing is copied or moved, and a file written again in place keeps its Comments and is read again.
- Comments anchored to a Frame or a Range, with Replies, Drawings, Mentions, Reactions and Attachments, and Resolved once they are done.
- Version Stacks for the iterations of a cut, and two Versions side by side or under a wipe, playing in sync.
- Approvals: approve a Version or request changes, and everyone sees who decided what.
- Review for outsiders on Project Links, Deliver's own links for a whole Project or picked Assets, wherever the files lie, and for single files in No Project: password, expiry, pause, comments, download, only the newest Version, a description above a grid of the Assets with downloads one by one, as a ZIP of all or of those picked, and who opened, watched and downloaded what. Every Reviewer gets a Personal Link, their own rights and an optional Watermark with their name. A Member who opens a link sees a read-only preview of what Reviewers see, with the way into Deliver. Sharing in Files stays plain Nextcloud sharing.
- Due Dates with reminders, Unseen Comments, notifications and mail, and live updates without reloading.
- Export of the Comments as EDL, FCP7 XML, FCPXML or CSV, as markers for the editing application.
- Audio counts to the millisecond: shown as `m:ss.mmm`, switchable to timecode or frames at the Project's frame rate.
- Proxies, Thumbnail Strips and Waveforms when ffmpeg is installed; without it, browser-native files play as they are, MOV, MP4 and Broadcast WAV keep their frame rate and start timecode, an MP3 the start its delivering tool wrote into its ID3 tag, WebM and MKV their frame rate, and audio still gets its Waveform.
- Scrub through a video by moving the mouse over its still, in Deliver and on a link's landing page; without ffmpeg on the server a frame of the video stands in for the still.
- Works on phones: the Review view, drawing with a finger and the Project list are made for small screens.
- Troubleshooting without a shell: setup checks on the admin overview, failed media jobs in the Nextcloud log and retried from Deliver's settings, and a support report to attach to an issue.
- English and German.
