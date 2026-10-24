---
status: accepted
---

# One Reviewer per email address, their own rights per link

Since ADR 0013 a Reviewer belongs to a Project, and their Personal Link works through every link of their Member there. Every invitation still made a new Reviewer, so the same person sent the whole Project and later one file of it became two Reviewers with two Personal Links, unless the Member reused one link for both, which cannot carry different rights. Rights of a Reviewer's own, set over those of the link, held on every link they came by alike, though the point of a second link is that it allows something else.

An email address is now one Reviewer per Project. An invitation with an address the Project knows, whatever its case, gives that Reviewer the new link too, under the name they already have; naming oneself with it mails them their Personal Link, under any name; and neither a Member nor a Reviewer can give an address that another Reviewer of the Project has. A Reviewer is on the links they were invited through or came by, and their Personal Link opens those and no other link of the Project: the links a Member sees them under, the Personal Links in their dialog and the links that open for them are the same. On another link of the Project they are not recognised; naming themselves there with their address puts them on it and mails them its Personal Link, and a replaced link is handed out again by inviting them on the new one (story 55). This replaces ADR 0013's Personal Link through every link of the Member on the Project. A Reviewer's own rights (comment, comment on older Versions, Watermark) belong to each link they are on.

## Considered Options

- Dropping rights of a Reviewer's own, since the invitation dialog makes a link of their own for each person: a Reviewer barred from commenting on a shared link would have been allowed again.
- Keeping them per Reviewer: the second link could not allow what the first did not.
- Assets picked per Reviewer instead of per link: link and Reviewer would both narrow what is shown, and ADR 0010 would no longer say what a link shows.

## Consequences

- The migration copies each Reviewer's own rights to every link they came by, so that nothing changes on those, and then drops them from the Reviewer. Whoever ever opened a link with their Personal Link came by it, so nobody loses a link they used; a link they never opened no longer opens for them.
- Two Reviewers who share an address from before stay as they are; the rule holds for every new invitation, naming and change of address.
- A new Reviewer still needs a name nobody in the review has when a Member invites them (story 53); an invitation with a known address adds a link to that Reviewer instead, under the name they have. Reviewers who name themselves may still share a name, told apart by their colour.
- An existing Reviewer keeps an address they share with another from before; only a change to an address someone else has is refused.
