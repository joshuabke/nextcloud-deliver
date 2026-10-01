---
status: accepted
---

# Takes are Assets in a Take Folder, not Versions, and not an extension of Compare

Takes of a recording are parallel passes over the same music, not iterations, so they cannot be a Version Stack: Version Numbers, "newest on top" and commenting only on the current Version would all be wrong for them. Each Take is its own Asset, and the folder holding one work's Takes becomes a Take Folder by a `"takes": true` flag in its Sidecar rather than by a database row, so a Delivery marks the folder with the files it writes and the mark travels with them (ADR 0002). The Take comparison is a view of its own rather than a generalised Compare: Compare lines up two Versions of one Asset with a Frame offset for re-edited cuts, while Takes line up any number of Assets on their Session Time and are switched while stopped, not played in parallel.

## Consequences

- Comments, Approvals and Unseen work on Takes unchanged, because they are Versions of ordinary Assets.
- The Project view and Share Links show a Take Folder as one entry that opens the comparison; its Takes are not listed one by one.
- Two Takes are comparable only as far as the recording session put them at the same Session Time; Deliver never aligns them itself.
