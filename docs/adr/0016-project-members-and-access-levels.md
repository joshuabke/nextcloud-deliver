---
status: accepted
---

# Project Members with an Access level of their own

ADR 0009 derived everything from Files: whoever can open a Version's file sees its review, comments with read access and manages it with write access, and Deliver stores no membership. That ties two decisions together that a team makes separately. Handing a colleague a folder in Files hands them the Project's review as well, a read-only share lets its recipients comment and decide on Approvals, and someone who should only manage the review needs write access to the files. Who may hand the Project to clients cannot be told apart from who may comment.

Deliver now keeps Project Members, each with an Access level of their own: None (does not see the Project in Deliver), View, Comment or Manage, and two switches next to it, Share (Review Links and Reviewers) and Approve (approve a Version or request changes). The level defaults to what Files allows, read giving Comment and write giving Manage, and a Member with Manage may set it above or below that. Files stays the source of truth for the files themselves (ADR 0002): nobody sees an Asset whose file they cannot open, and whatever touches a file (upload, rename, delete) still needs Files' own permission. The Access level decides what someone does with the review of the files they can open.

## Considered Options

- Deliver's rights only narrowing what Files allows: simpler, but it leaves no way to let someone with read access manage the review, which is a common split between whoever cuts and whoever runs the review.
- Members added by hand, with no access until then: matches "sharing the folder does not share the Project", but every share in Files would have to be repeated in Deliver, and the Files sidebar would have to hide the review from people who can open the file. A default for newcomers of View or None gets the same effect without the double bookkeeping.
- Groups resolved into people only: closer to how notifications already work, but a share with a team of fifty would be fifty entries to set one by one.

## Consequences

- The Project Members are whoever can open one of the Project's files, listed as Files grants it: a person or a group. A person's own entry always wins over their groups; across several groups, the highest level and every switch any of them has count, each group at its entry or, once noted, where it stands, whether or not the person was noted themselves; only a person none of whose groups has an entry or a note starts from the newcomers setting.
- A Project setting decides what someone newly given access in Files starts with: as in Files (the default), View or None.
- A group id can be given to the next group created, so deleting a group removes its Project Member entries; a group later created under the id starts as anyone newly given access does.
- Members with Manage set the levels and switches, never above their own. The Project's owner (the folder's owner for a Folder Project, whoever made any other Project) always has Manage, Share and Approve and cannot be lowered. A Folder Project in a group folder has no owner; there the last Member with Manage cannot be lowered.
- Share is offered only where Files lets the Member reshare: on a Folder Project its folder, on any other Project at least one of its files. A Review Link still shows only files its maker may reshare (ADR 0010).
- Approve is on by default for Manage only, so read access in Files no longer decides on Approvals unless a Member with Manage switches it on. Reviewers still decide where their link lets them comment.
- None hides the Project: no listing, no notifications, no Mentions. The Files sidebar says only that the file is in review in a Project. View and above are notified and can be mentioned.
- ADR 0009's "comments with read access and manages it with write access" and "Deliver stores no membership" are superseded; the rest of it stands. Access follows the file still decides which Assets each person sees.
