---
status: accepted
---

# Review runs on Project Links only, not on Nextcloud Share Links

ADR 0004 put review on Nextcloud Share Links, and ADR 0010 added Project Links next to them for Projects without one folder. That left Members with two kinds of review link: one made in Files with flags as share attributes, one made in Deliver with settings of its own. Pausing, picked Assets, the activity on a link and only some of the rights worked on one kind and not the other, and the same Reviewer could come by either. Members had to know which kind of link they were looking at to know what it would do.

A Project Link can do everything a review Share Link did, and more: it shows a whole Project or picked Assets wherever their files lie, can be paused, records who opened what, opens on a landing page with the Project's description and hands out the newest Versions as one ZIP. So review runs on Project Links only. Where Deliver used to make a Share Link (the Files sidebar tab, the Review view's Share dialog), it makes a Project Link on the Asset's Project with only that Asset picked, or one for the whole Project on a Folder Project's folder. A file in No Project gets a link too: a Project Link can be made on No Project, and then shows only Assets of it that the Member picks.

Nothing is released, so there are no review Share Links to carry over and no migration.

## Considered Options

- Keep both kinds (ADR 0010 as it stood): every setting has to be built twice or explained as missing on one kind.
- Share Links only (ADR 0004): cannot carry a Project whose files lie anywhere (ADR 0009).

## Consequences

- Sharing a file or folder in Files makes a plain Nextcloud link: it shows files and nothing of Deliver's. The Review switch in Files' share dialog and the Review button on Nextcloud's public share page are gone.
- A Project Link on No Project needs at least one picked Asset; an Asset leaves it once it joins a Project.
- The review page stays the routes under `/s/{token}` extending `OCP\AppFramework\AuthPublicShareController` and `PublicShareController`, so core still asks for the password, keeps the session and throttles guessing. Deliver stores tokens and password hashes (`OCP\Security\IHasher`) for all review links.
- Reviewers, Personal Links and mails to Reviewers go only through live Project Links; a mail links to a Version only through a link that shows it.
- ADR 0004 is superseded.
