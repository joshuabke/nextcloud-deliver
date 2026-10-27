# Using Deliver

How Deliver behaves for the Members who review with it. The words in bold are the ones Deliver uses in its interface; the [glossary](../CONTEXT.md) defines them.

## Deliver and Files

Your media stays in Files. Deliver keeps the review around it: Comments, Drawings, Approvals, Review Links and the Proxies it makes for playback.

### What Deliver does to your files

- Making a **Project**, enabling a file for review, deleting a Project or removing an **Asset** never moves, copies or deletes a file.
- Deliver changes a file only when you ask it to in Deliver: uploading puts new files into Files, renaming a file renames it there, and **Delete** on an Asset moves its files to the trash of Files.
- Whatever you do in Files works as always: sharing, moving, renaming, deleting. Deliver follows.
- Except for a file with Comments or Approvals: Deliver **locks** it, so that nobody overwrites, renames or deletes it outside Deliver by accident, a sync client included. Files shows it as locked by Deliver. Replacing, renaming and deleting through Deliver still work, and whoever owns the file can lift the lock in Files. A Member with **Manage** can switch the lock off for a Project.
- Where a file in review is overwritten anyway, without the lock, its Comments stay and are marked as made before the overwrite, and the Project's Members are notified.

### One file, one Version, one Project

- A file is one **Version** at most, and it belongs to one Project at most, or to **No Project**. The same file cannot be reviewed in two Projects.
- A file keeps its Version and its Project wherever you move it and whatever you rename it to, so reorganising folders loses nothing.
- Who sees a Version's review follows the file: whoever can open the file in Files is a **Member** of its Project.
- What a Member may do there is their **Access level** in the Project: **None** (does not see the Project), **View**, **Comment** or **Manage**, with the switches **Share** (Review Links and Reviewers) and **Approve**. It starts from Files, read access giving Comment and write access giving Manage, and a Member with Manage can set it higher or lower in the Project's settings. Changing a file itself still needs write access in Files. On a Project without a folder, the Project's own settings and Members stay with whoever made it and with those a Member with Manage set, while write access to a file still lets a Member manage that Asset.
- Each Version shows who **delivered** it: who uploaded or synced the file, or enabled it for review. Delivering gives no rights; in a shared folder every file belongs to the folder's owner, whoever brought it.
- **Auto Intake** of a **Folder Project** takes in every media file in its folder, except files another Project holds and files a Member removed from review there.

### When files go to the trash or are deleted for good

- A file in the trash of Files makes its Version **Missing**. Its Comments stay, and restoring the file in Files brings the Version back.
- A file deleted for good, from the trash or by emptying it, takes its Version and all of its Comments along. This holds in every Project, a Deleted Project too.
- A Folder Project whose folder is deleted for good keeps its Assets, without a folder and without Auto Intake.

### Deleted Projects

- Deleting a Project moves it to **Deleted Projects**, at the end of the Project list. It stays there for 30 days, or as many as your admin set. Its locks are lifted meanwhile, so that its files can go to the trash; restoring it locks them again.
- Whoever may change the Project sees it there: its Members with Manage. Once its folder is out of reach, as in the trash of Files, whoever deleted it. From there it is restored with everything whose file still exists, its Review Links as they were, or deleted for good at once.
- A Project cannot be deleted while it holds an Asset you may not change; Deliver names those you can open and counts the others. Move them to another Project or remove them first, or ask whoever can.
- While deleted, a Project still holds its files: no other Project and no Auto Intake takes them. Its Review Links are closed, and nobody is notified about it. Making its folder a Project again, or enabling one of its files, offers whoever may change the Project to restore it, or to delete it for good and start afresh.
- Deleted for good, when its time is up or by hand, everything of the Project goes: Assets, Versions, Comments, Approvals, Drawings, attachments, Proxies, Review Links and its Reviewers. The files stay where they are in Files. A Reviewer whose Comments live on in another Project, on an Asset moved there, keeps their name there. To keep the people you worked with, save them to your address book from their menu.

### When an account is deleted

- A Folder Project the account made passes to whoever owns the folder.
- Any other Project it made is deleted for good at once, since nobody else could restore it.
- Its Comments, Approvals and Reactions elsewhere stay, by a Deleted user.
