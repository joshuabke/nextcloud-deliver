# Deliver

**Multimedia review tool for creatives.** 100% free, feature-complete alternative to Frame.io, but aspiring for more.

> [!NOTE]
> Deliver is approaching v1.0 and will still have some bugs. Please help by [creating an issue](https://github.com/joshuabke/nextcloud-deliver/issues/new) for everything you find!

[![The Review view: a Comment on a Range with a Drawing, Replies and Reactions](docs/screenshots/banner.png)](https://apps.nextcloud.com/apps/deliver)

## What it does

- 📂 **Review in place** from the Files sidebar, or a whole folder as a Project. Nothing is copied or moved.
- 🎯 **Comments on the Frame** or a Range, with Drawings, Replies, Reactions, Mentions and Attachments
- 🗂️ **Versions** stack by name (`…_v1`, `…_v2`) and compare side by side or under a wipe
- ✅ **Sign-off** with Approvals, Due Dates and reminders
- 🔗 **Clients without accounts** on Review Links: password, expiry, Watermark, downloads, and who watched what
- ⬆️ **Uploads in Deliver** that resume after an interruption, run in the background and show the processing until it is done
- 🎬 **Back into the edit** export comments as markers for:
  - Video: DaVinci Resolve (EDL), Premiere Pro (FCP7 XML), Final Cut Pro (FCPXML), CSV
  - Audio: WAV markers, MIDI, REAPER regions, Ableton Live Set
- 🎞️ **Supported files**
  - Video: MP4 and MOV (H.264), WebM
  - Audio: WAV, FLAC, MP3, AAC, Ogg
  - Images: JPEG, PNG, WebP, GIF, AVIF
  - Everything else (ProRes, H.265, MXF, AVI …) needs ffmpeg
- 🌊 **Waveforms, thumbnails and scrubbing** by hovering over a video
- 📱 **Fully mobile ready**: use it as a web app on iOS and Android, and get notifications through the official Nextcloud app
- ⚡ **With ffmpeg on the server**
  - Proxies, thumbnails and waveforms for every format ffmpeg reads
  - Hardware encoding: VAAPI, NVENC, VideoToolbox

More screenshots are on the [App Store page](https://apps.nextcloud.com/apps/deliver).

## Roadmap

- **1.0**: the 0.x pre-releases settle, srt-subtitles support
- **1.1 – Takes**: compare the Takes of a recording session on one timeline, jump between them at the same position and comment on the one that works

## Installation

Install **Deliver** from the Nextcloud App Store: *Apps → Multimedia → Deliver*. It needs Nextcloud 33 to 35 and PHP 8.2 or newer. How it fares on hosted Nextcloud is [below](#hosted-nextcloud).

Everything else is optional:

- **ffmpeg and ffprobe** on the server, for Proxies, Thumbnail Strips and hardware encoding (*With ffmpeg on the server* above). Shared hosting without them works for browser-native files.
- **The Movie preview provider**, so that lists show a still of each video instead of an icon.
- **[notify_push](https://github.com/nextcloud/notify_push)**, so that new Comments reach open Review views at once instead of within seconds.

The details are in [docs/admin.md](docs/admin.md); a Compose setup for a server of your own is in [deploy/](deploy/README.md).

## Hosted Nextcloud

Deliver runs without ffmpeg and without a shell, so a managed Nextcloud can run it. 
Here is a table of providers and when the info was verified. 
Everything marked with a ❓ has yet to be confirmed and is just assumed from their documentation.
Additions or corrections are welcome as issues or pull requests!

| Provider | Installable | ffmpeg | Shell / `occ` | Verified | Comment |
| --- | --- | --- | --- | --- | --- |
| Own server ([deploy/](deploy/README.md)) or VPS | ✅ | ✅ | ✅ | 2026-10 | Full root access |
| wolkesicher.de (Managed Standard) | ✅ | ✅ | ❌ | 2026-11 | `ffmpeg` included on standard managed plans; no SSH/`occ` without upgrading |
| Hetzner Storage Share | ✅ | ❌ | ❌ | 2026-10 | Managed SaaS (distinct from Hetzner Cloud VPS); `ffmpeg` is on their roadmap |
| Webo (Admin Shared) | ✅ | ❌ | ❌ | 2026-10 (by AI) | Shared hosting tier with Nextcloud Admin & App Store |
| Tab.digital (Managed Nextcloud) | ✅ | ❌ | ❌ | 2026-10 (by AI) | Managed `cloud.tab.digital` tiers (Standard/Premium) include App Store |
| Zaclys (Stratus, Alto, Cirrus) | ✅ | ❌ | ❌ | 2026-10 (by AI) | Dedicated managed instances with Admin & App Store; server/SSH/`occ` via support |
| Cloud68 (Managed Dedicated) | ✅ | ❓ | ❌ | 2026-10 (by AI) | Admin & App Store access (ticket recommended for untested apps); no SSH/`occ` provided |
| hosting.de Managed Nextcloud | 🟡 | ❌ | ❌ | 2026-10 | Managed SaaS (distinct from hosting.de VPS); whitelisted apps via support/panel only, no SSH/`occ` |
| Woelkli (own instance) | 🟡 | ❌ | ❌ | 2026-10 (by AI) | Private multi-user plans (Levels C5–C7) allow selecting from a curated plugin catalog only; no SSH/`occ` |
| The Good Cloud | 🟡 | ❌ | ❌ | 2026-11 | No app store on free/personal tiers; pre-selected apps on Business plans; no shell/`occ` |
| Stackhero (Managed Nextcloud) | ❌ | ❌ | ❌ | 2026-10 (by AI) | Currently stuck on NC 32; immutable container with no SSH/`occ` or `ffmpeg` |
| IONOS Managed Nextcloud | ❌ | ❌ | ❌ | 2026-11 | Currently stuck on NC 32; locked-down SaaS (distinct from IONOS Cloud/VPS), no SSH/`occ` |
| Murena Workspace | ❌ | ❌ | ❌ | 2026-10 (by AI) | Fixed /e/OS cloud ecosystem; no custom apps, no `ffmpeg`, no shell/`occ` |
| Framaspace | ❌ | ❌ | ❌ | 2026-10 (by AI) | Locked-down NGO/community instance with fixed app list; no App Store or CLI access |
| MagentaCLOUD | ❌ | ❌ | ❌ | 2026-10 (by AI) | Proprietary Telekom Nextcloud fork; closed ecosystem, no App Store or shell |
## Documentation

- [Running Deliver](docs/admin.md): requirements, the derived-media pipeline, hardware encoders, live updates
- [Developing Deliver](docs/development.md): the dev instance, tests, packaging and releases
- [API](docs/api.md): the OCS API and the Reviewer's surface
- [Glossary](CONTEXT.md), [decisions](docs/adr/) and the [spec](docs/spec-v2.md)
- [Changelog](CHANGELOG.md)

## License

AGPL-3.0-or-later. The footage in the screenshots is from *Tears of Steel*, (CC) Blender Foundation | [mango.blender.org](https://mango.blender.org), CC BY 3.0.
