---
status: accepted
---

# Review runs on Nextcloud Share Links, not on a link type of its own

ADR 0001 gave Deliver its own `review_links` table with tokens, password hashes, expiry and flags, because core link shares are per file, carry no reviewer identity and used to take the comment history with them. Identity and history are solved elsewhere: Comments belong to a Version, and Reviewers are Deliver's own entity with a permanent key. What remained was a second, parallel way to hand out a URL — with its own password prompt, its own expiry and its own management UI next to the one Nextcloud already ships.

The client should open the Share Link they were sent, see the files, and press Review on the ones that are enabled. Deliver therefore adds itself to the existing public share page instead of replacing it: a listener on `OCA\Files_Sharing\Event\BeforeTemplateRenderedEvent` loads Deliver's script into the public file list, which registers a Review file action for enabled Assets. The review view itself is an app route extending `OCP\AppFramework\AuthPublicShareController`, so the share's password and expiry are enforced by core before Deliver sees the request.

## Consequences

- Deliver stores no tokens and no password hashes. Password, expiry, revocation and "hide download" are share properties, edited in the Files sharing panel.
- Review is opt-in per share: a Share Link is a review surface only while its `deliver/review` attribute is set. Sharing a Deliver-enabled file without that attribute shows the file and nothing else, so the same cut can go out twice — once to watch, once to review.
- Deliver's share flags (`deliver/review`, `deliver/comment`, `deliver/older`) are Nextcloud share attributes, not Deliver rows: they are created with the share, deleted with it, and can never outlive it.
- Revoking or replacing a Share Link never deletes Comments; they belong to the Version. A Reviewer's Personal Link is re-issued against the new share.
- Reviewers without any Share Link do not exist: reviewing outsiders always come through Files sharing, including its own limits (share expiry policies, password enforcement, federated shares).
- A Member who opens a Share Link is redirected into the app view, so they never review with reduced rights.
- ADR 0001 is superseded.
