---
status: accepted; the mark of a Take Folder in its Sidecar is superseded by [0012](0012-start-is-in-the-file.md)
---

# Takes are not Assets: one file each, no Versions, only in the Take comparison

ADR 0006 made each Take an Asset so that Comments, Approvals and Unseen would work on it unchanged. That also brought along everything an Asset has that a Take must not have: a Version Stack, the Review view, an Asset card. A Take is a parallel pass, not an iteration, and only makes sense next to the other Takes of its Take Folder. So a Take is a concept of its own: one file in a Take Folder with Comments, without Versions, opened only in the Take comparison. Stored, it remains an Asset row with exactly one Version row, because Comments, Approvals, Unseen, notifications and exports all hang on a Version; that is the storage, not the concept. The rest of ADR 0006 stands: a folder becomes a Take Folder by `"takes": true` in its Sidecar, and the Take comparison is a view of its own rather than a generalised Compare.

## Consequences

- A Take is never stacked or unstacked, never gets a second Version (no "upload a new Version", no stacking by the filename convention or Auto Intake inside a Take Folder), and is never opened in the Review view or listed as an Asset card.
- Delivering a Take again replaces its file in place. When it has Comments, the delivering tool asks first; without the confirmation the Take is skipped, never added as a new Version.
- Comments, Approvals and Unseen work on Takes as before, through their one Version.
- Supersedes ADR 0006.
