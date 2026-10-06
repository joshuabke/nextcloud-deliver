# Deliver

**Frame-accurate video and audio review, right where your files already are.**

> **Pre-release.** The 0.x releases come before 1.0: use Deliver on real projects, but keep your own backups and expect rough edges. 1.0 follows once they have settled.

Deliver turns Nextcloud into a review tool for cuts, mixes and stills, in the spirit of Frame.io, but on your own server. Your team and your clients comment on exact Frames, draw on the picture, compare Versions and sign them off. The feedback goes back into the editing application as markers. Nothing is uploaded anywhere else and nothing is copied: Nextcloud Files stays the source of truth.

![The Review view: a Comment on a Range with a Drawing, Replies and Reactions](docs/screenshots/review.png)

## What it does

- **Review in place.** Enable a video, audio or image file from the Files sidebar, or turn a whole folder into a Project that takes in every media file. Projects collect files from anywhere without moving them, whoever can open a file in Files sees its review, and a file written again in place keeps its Comments.
- **Comments on the Frame.** Anchor a Comment to a Frame or a Range, draw on the picture with pen, arrow or box, reply, react, mention a colleague, attach a reference, and resolve it once it is done.
- **Versions that stack.** A new cut named `…_v2` next to `…_v1` lands on top of it by itself. Compare two Versions side by side or under a wipe, playing in sync.
- **Sign-off.** Approve a Version or request changes, set Due Dates with reminders, and see at a glance what is unseen, approved or due.
- **Clients without accounts.** Review runs on Project Links: one link for a whole Project, the Assets you pick or a single file, with password, expiry, pause and a landing page to download from, one by one or as a ZIP. Every Reviewer gets a Personal Link, rights of their own and, if you like, a Watermark with their name over the picture.
- **Back into the edit.** Export the Comments as markers for DaVinci Resolve (EDL), Premiere Pro (FCP7 XML), Final Cut Pro (FCPXML) or as CSV; for audio as WAV markers, MIDI, REAPER regions or into an Ableton Live Set.
- **Heavy media, light browser.** With ffmpeg on the server, Deliver makes Proxies for formats a browser will not play, Thumbnail Strips for the timeline and Waveforms, with hardware encoding if you have it. Without ffmpeg, browser-native files play as they are, keep their frame rate and start timecode, and audio still gets its Waveform, decoded in the browser.
- **Everywhere.** Live updates without reloading, a Review view made for phones, English and German.
- **No shell needed.** Setup checks on the admin overview, failed media jobs retried from Deliver's settings, and a support report to attach to an issue: made for hosted Nextcloud too.

| Compare two Versions under a wipe | A client on a Project Link, with Watermark |
| --- | --- |
| ![Compare view: the flat v1 against the graded v2](docs/screenshots/compare.png) | ![A Reviewer's page with a Watermark and the Approval "Changes requested"](docs/screenshots/reviewer.png) |
| **A Project: filters, Approvals, Due Dates** | **On a phone** |
| ![A Project with its Assets as cards](docs/screenshots/project.png) | <img src="docs/screenshots/phone.png" alt="The Review view on a phone" width="260"> |

## Installation

Install **Deliver** from the Nextcloud App Store: *Apps → Multimedia → Deliver*. It needs Nextcloud 33 or 34 and PHP 8.2 or newer. How it fares on hosted Nextcloud is in [Hosted Nextcloud](docs/admin.md#hosted-nextcloud).

Everything else is optional:

- **ffmpeg and ffprobe** on the server for Proxies, Thumbnail Strips and Waveforms, and for hardware encoding. Shared hosting without them works for browser-native files.
- **The Movie preview provider**, so that lists show a still of each video instead of an icon.
- **[notify_push](https://github.com/nextcloud/notify_push)**, so that new Comments reach open Review views at once instead of within seconds.

The details are in [docs/admin.md](docs/admin.md); a Compose setup for a server of your own is in [deploy/](deploy/README.md).

## Documentation

- [Running Deliver](docs/admin.md): requirements, the derived-media pipeline, hardware encoders, live updates
- [Developing Deliver](docs/development.md): the dev instance, tests, packaging and releases
- [API](docs/api.md): the OCS API and the Reviewer's surface
- [App Store](docs/app-store.md): certificate, registration and publishing
- [Glossary](CONTEXT.md), [decisions](docs/adr/) and the [spec](docs/spec-v2.md)
- [Changelog](CHANGELOG.md)

## License

AGPL-3.0-or-later. The footage in the screenshots is from *Tears of Steel*, (CC) Blender Foundation | [mango.blender.org](https://mango.blender.org), CC BY 3.0.
