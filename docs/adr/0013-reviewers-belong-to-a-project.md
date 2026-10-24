---
status: accepted
---

# Reviewers belong to a Project

ADR 0009 gave each Reviewer to the Member who invited them, with a Personal Link through every Project Link of that Member. A Member who reviews with two clients then showed each client's people in the other's link settings, offered them in the other's lists and mailed them the other's new Versions and Comments, with a Personal Link that opened the other Project. Who reviews one Project has no business in another.

A Reviewer now belongs to the Member and to one Project: the Project of the link they were invited through or named themselves on, or No Project. Their Personal Link works through every link of that Member on that Project, so a replaced link can still be handed out again (story 55), and through no other. The same person on another Project is another Reviewer there, with a Personal Link of their own.

## Considered Options

- Reviewers from Nextcloud's contacts, invited on any Project from the Member's address book: the better long-term answer, as one person is then the same everywhere they are invited, but it needs a contacts integration first. Until it exists, a Reviewer stays within one Project. Contacts came as a source of name and address only (#66): a Reviewer invited from them is still one of the Project, and one identity across Projects waits until after 1.0, together with Project-wide Reviewers and links (#48).
- Only hiding other Projects' Reviewers from the lists: the Personal Link and the mails would still reach across Projects.

## Consequences

- Listing, inviting, naming oneself again with the same name and address, and mails to Reviewers all stay within the Project. On No Project, a Reviewer belongs to all of the Member's links there.
- A Reviewer who came by links of several Projects before this keeps the first of them and leaves the others' lists; a Member invites them again there. One whose links are all gone joins the Project of their first Comment; one with neither link nor Comment is removed.
- ADR 0009's consequence on Reviewers is superseded; the rest of it stands.
- The Personal Link through every link of the Member on the Project is narrowed by ADR 0014 to the links the Reviewer is on.
