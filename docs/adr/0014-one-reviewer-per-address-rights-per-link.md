---
status: accepted
---

# One Reviewer per email address, their own rights per link

Since ADR 0013 a Reviewer belongs to a Project, and their Personal Link works through every link of their Member there. Every invitation still made a new Reviewer, so the same person sent the whole Project and later one file of it became two Reviewers with two Personal Links, unless the Member reused one link for both, which cannot carry different rights. Rights of a Reviewer's own, set over those of the link, held on every link they came by alike, though the point of a second link is that it allows something else.

An email address is now one Reviewer per Project. An invitation with an address the Project knows, whatever its case, gives that Reviewer the new link too, under the name they already have; naming oneself with it mails them their Personal Link, under any name; and neither a Member nor a Reviewer can give an address that another Reviewer of the Project has. A Reviewer's own rights (comment, comment on older Versions, Watermark) belong to each link they came by, and a link they never came by gives them its own.

## Considered Options

- Dropping rights of a Reviewer's own, since the invitation dialog makes a link of their own for each person: a Reviewer barred from commenting on a shared link would have been allowed again.
- Keeping them per Reviewer: the second link could not allow what the first did not.
- Assets picked per Reviewer instead of per link: link and Reviewer would both narrow what is shown, and ADR 0010 would no longer say what a link shows.

## Consequences

- The migration copies each Reviewer's own rights to every link they came by, so that nobody gains or loses one, and then drops them from the Reviewer.
- Two Reviewers who share an address from before stay as they are; the rule holds for every new invitation, naming and change of address.
- Without an address, a name already taken in the review is still refused, as two people without one cannot be told apart.
