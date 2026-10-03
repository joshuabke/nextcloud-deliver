---
status: accepted; what a Project is and who its Members are is superseded by 0009
---

# Files is the source of truth; Deliver stores only review state

A Project is a folder in Nextcloud Files, an Asset's Versions are files in it, and Members are whoever Files permissions let in. Deliver's database holds only what Files cannot express: Project flags, Version Stacks, media metadata (fps, start timecode), Comments, Review Links, and notification preferences. No uploads bypass Files, no separate library or ACL exists, and no media is copied or moved by Deliver.

## Consequences

- Renames and moves are free because everything is keyed by file id.
- A Version whose file disappears is shown as missing but keeps its Comments until removed deliberately.
- Roles are derived: read on the folder = view and comment, write on the folder = manage links, stacks, resolve, export.
