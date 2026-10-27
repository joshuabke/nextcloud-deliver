---
status: accepted
---

# Files in review are locked against silent overwrites

A file written again in place keeps its Version and Comments (spec: Delivering again). Deliver's own upload and a delivering tool ask before they replace a Version that has Comments, but the Files app and a sync client cannot be asked: a sync client can put a different cut under Comments made on the old one without anyone noticing.

Deliver now locks the file of every Version with Comments or Approvals with an app lock of its own through Nextcloud's lock API (`files_lock`, shipped and enabled by default). Overwriting, renaming and deleting the file then fail for everyone, its owner's sync client included, and Files shows it as locked by Deliver; moving the folder it lies in still works. Deliver's own actions run inside its lock: a confirmed replace on upload, deleting an Asset with its files, renaming. A delivering tool replaces a Version's file through Deliver, with the same confirmation. The file's owner can lift the lock in Files, and an admin with `occ files:lock`.

## Considered Options

- No lock, the overwrite marked and notified: never stands in anyone's way, but the Comments are on the wrong picture before anyone looks.
- The overwrite becoming a new Version on its own: Deliver would have to copy the old content into a file of its own next to it, and Deliver never writes to Files unasked (ADR 0002).
- File Access Control with a tag: blocks reading as well, and needs an admin's rule.

## Consequences

- The lock comes with the first Comment or Approval and goes when none is left or the Version leaves Deliver. A Comment by someone with read access locks the file for its owner too; that is the point.
- It is on while `files_lock` is available, with a Project setting to switch it off.
- Deleting a Project releases its locks, so that its files can go to the trash meanwhile; restoring it sets them again.
- Where there is no lock, or it was lifted, an overwrite is taken as before, and its Comments are marked as made before it, with a notification to the Members.
- There is no general unlock in Deliver's API.
