---
status: superseded by [0004](0004-review-runs-on-nextcloud-share-links.md)
---

# Review Links are Deliver's own entity, not Nextcloud core link shares

The previous version keyed comments to core `TYPE_LINK` shares, which are per file, carry no reviewer identity, and take the comment history with them when revoked. Deliver now owns a `review_links` table: a token scoped to a Project or an Asset, hashed password, expiry, and flags for commenting and downloading originals. Reviewers get a server-issued session bound to the link so they can only edit their own Comments.

## Consequences

- Review Links do not appear in the Files sharing panel; they are managed in Deliver's UI and the Deliver sidebar tab.
- Revoking a link never deletes Comments, because Comments belong to a Version, not to a link.
- Core shares of a video file still work as plain downloads but are not review surfaces.
