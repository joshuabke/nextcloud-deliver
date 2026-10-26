---
status: accepted
---

# Deleting a Project keeps it as a Deleted Project, then deletes all of it

ADR 0009 removed a Project by sending its Assets to No Project with their review data, so that reorganising never lost a Comment. In practice a Member removing a Project means a finished job: No Project filled up with Assets nobody wanted, each to be removed again by hand, and the job's Reviewers and Review Links had nowhere to go. Deleting a Project now keeps it, whole, as a Deleted Project for a time the admin sets (30 days unless changed), from where whoever may change it restores it or deletes it for good; when the time is up it is deleted for good on its own. Deleted for good, all data of the Project goes: Assets, Versions, Comments, Approvals, Drawings, attachments, derived media, Review Links and its Reviewers. The files are never touched (ADR 0002).

A Deleted Project still holds its files, so that a restore brings back everything whose file is still there: no other Project and no Auto Intake takes them meanwhile, and making its folder a Project again or enabling one of its files offers its restore, or deleting it for good and starting afresh. Its Review Links are closed and nothing about it is notified. Deleting is refused while the Project holds an Asset the Member may not change, since its data would go for good with the rest when the time is up; restoring and deleting for good do not ask again.

## Considered Options

- Assets to No Project, as before: keeps every Comment, but leaves a finished job's Assets behind for each Member to clear, and nothing of the job is ever gone.
- Deleting at once, with a confirmation: what a Member wants most of the time, but one slip loses a job's whole review, and Files' own trash gives no way back to it.
- A Deleted Project that keeps its review data forever, as a record for disputes with a client: a store of other people's names and addresses that nobody sees. A record a Member keeps outside Deliver is the better evidence (the export of #87), and a finished job that should stay is archived on purpose (#87).
- A Deleted Project that lets go of its files at once, so that another Project can take them: its restore could no longer bring everything back.

## Consequences

- Story 9 goes: there is no way to remove a Project that keeps its Assets. To keep an Asset, a Member moves it to another Project first.
- A file deleted for good in Files still takes its Version along, in a Deleted Project too (ADR 0002); a file in Files' trash leaves its Version Missing until both are restored.
- A Reviewer whose Comments live on in another Project, on an Asset moved there, keeps their name there when their Project is deleted for good; every other Reviewer of the Project goes, as Deliver keeps no Reviewer without a Project. People worth keeping belong in the Member's address book.
- A deleted account's Projects other than Folder Projects are deleted for good at once, as nobody could restore them; its Folder Projects pass to the folder's owner as before.
- Open notifications about a Project are dismissed when it is deleted and do not come back with a restore.
