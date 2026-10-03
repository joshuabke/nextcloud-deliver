---
status: accepted
---

# Projects are collections, a folder is optional, and access follows the file

ADR 0002 made a Project a folder and its Members whoever Files lets into that folder. That made a single file impossible: enabling it turned its whole folder into a Project, and a cut could only belong to the Project of the folder it lay in. A Project is now a collection in Deliver. A Folder Project is bound to a folder and can take in everything in it by Auto Intake, as before; any other Project is named by the Member who made it and collects files from anywhere. A file can also be enabled with no Project at all and then waits under No Project for whoever enabled it. Enabling a file never makes a Project, and assigning a file to a Project never moves it.

Since a Project no longer has one folder whose permissions it could borrow, access follows each file: whoever can open a Version's file in Nextcloud sees its review, comments on it with read access and manages it with write access. Files stays the source of truth (ADR 0002) and Deliver still stores no membership.

## Considered Options

- Projects stay folders, and assigning a file means moving it into the Project folder: keeps one permission source, but Deliver would move media and a file could serve one Project only by where it lies.
- Members stored in Deliver: a list Deliver would have to keep in step with Files, and still nobody could play a file Files does not let them open.

## Consequences

- A Project shows each person only the Assets whose files they can open, and appears in their list as soon as they can open one of them; a Folder Project also appears to whoever can reach its folder. A Folder Project's settings follow write access to the folder; any other Project's name, settings and removal belong to the Member who made it.
- Removing a Project never deletes review data: its Assets go to No Project. Deleting a file for good still purges its Version (ADR 0002).
- A file is one Version at most, in one Project or none. Auto Intake takes in only files no Project holds; a file that moves keeps its Project, wherever it goes.
- Notifications, Mentions and live updates reach the people who can open the Version's file; muting stays per Project, with one more mute for No Project.
- Reviewers belong to the Member who invited them, and a Personal Link works through every Project Link of that Member (ADR 0011).
- Attachments live in Deliver's app data, like derived media, and go with their Comment.
- A Version Stack never spans Projects: stacking a file onto an Asset brings it into that Asset's Project, and needs write access to both files.
