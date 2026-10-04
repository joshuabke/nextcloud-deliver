---
status: accepted
---

# Project Links: Deliver's own review links for a Project

ADR 0004 put review on Nextcloud Share Links, because a link of Deliver's own meant a second password prompt, a second expiry and a second management UI. ADR 0009 then made a Project a collection: its files can lie anywhere, and a Project without a folder has no node a Nextcloud Share Link could point at. The only ways to hand such a Project to a client were a link per file or moving the files into one folder, which Deliver never does.

A Project Link is a link Deliver makes for a Project. It shows the whole Project, growing as Assets join, or only the Assets the Member picks, so that one Project can go out with different access: the rough cut to the agency, the final to the broadcaster. It carries what a Frame.io Share carries: password, expiry, comments, comments on older Versions, Watermark, download, only the newest Version, a pause switch, a description for the landing page, and the activity on it.

It does not bring back a password prompt of Deliver's own. The review page and its API stay the routes under `/s/{token}` that extend `OCP\AppFramework\AuthPublicShareController` and `PublicShareController`; the token resolves to either a Nextcloud Share Link or a Project Link, and core still asks for the password, keeps the session and throttles guessing. Deliver stores the password only as a hash from `OCP\Security\IHasher`.

## Considered Options

- A link per file, from Files: works today, but the client gets a pile of links and no Project.
- Nextcloud collaboration resources (`OCP\Collaboration\Resources`): group things, but cannot be shared publicly.
- A share provider of Deliver's own in Nextcloud's sharing: link shares are core's type and always point at one node.

## Consequences

- "Create Review Link" in Deliver makes a Project Link, for a Folder Project too. Since ADR 0011 it is the only review link; Nextcloud Share Links no longer review.
- A Project Link shows only files the Member who made it may share in Nextcloud, as a reshare would; it shows nothing once they lose access, and goes with its Project.
- Reviewers, Personal Links and the activity of a link are keyed by its token.
- Deliver now stores tokens and password hashes again, for Project Links.
