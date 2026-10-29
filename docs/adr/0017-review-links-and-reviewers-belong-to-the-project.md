---
status: accepted
---

# Review Links and Reviewers belong to the Project

Since ADR 0013 a Reviewer belongs to the Member who invited them and to one Project, and since ADR 0014 an email address is one Reviewer per Member and Project. A client invited on the same Project by two Members is two Reviewers with two Personal Links, their Comments under two identities, and each Member sees and manages only their own links and Reviewers. When a Member is away, nobody else can pause their link or hand their client a new one.

Review Links and Reviewers now belong to the Project. One client is one Reviewer with one Personal Link per link they are on, whoever invited them, and an email address is one Reviewer per Project. Every Member with Share (ADR 0016) sees and manages every link and Reviewer of the Project, their own rights on each link included, and each link says who made it. What a link shows is still bound to its maker: only files they may reshare (ADR 0010).

## Considered Options

- Links per Member, Reviewers per Project: one client stays one person, but a link would still have only one Member who may change it.
- One Reviewer across all Projects, from the Member's contacts: deferred, as in ADR 0013; a Reviewer stays one of a Project.

## Consequences

- A migration merges the Reviewers of one Project who share an address into one, keeping the oldest, with every link each was on and their Comments, Approvals, Reactions and Unseen state.
- No Project stays per Member: links and Reviewers there remain the Member's own, as nobody else sees its Assets.
- ADR 0013's and ADR 0014's "per Member" is superseded; a Reviewer belongs to a Project, and their key per link and their own rights per link stand.
