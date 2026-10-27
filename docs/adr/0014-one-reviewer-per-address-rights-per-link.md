---
status: accepted
---

# One Reviewer per email address, a key and their own rights per link

Since ADR 0013 a Reviewer belongs to a Project, and their Personal Link works through every link of their Member there. Every invitation still made a new Reviewer, so the same person sent the whole Project and later one file of it became two Reviewers with two Personal Links, unless the Member reused one link for both, which cannot carry different rights. Rights of a Reviewer's own, set over those of the link, held on every link they came by alike, though the point of a second link is that it allows something else.

An email address is now one Reviewer per Member and Project, as Reviewers belong to both (ADR 0013). An invitation with an address the Project knows, whatever its case, gives that Reviewer the new link too, under the name they already have; naming oneself with it mails them their Personal Link, under any name; and neither a Member nor a Reviewer can give an address that another Reviewer of the Project has. A Reviewer is on the links they were invited through, put on or named themselves on, and each of those has a key of its own: their Personal Link through a link is that link's URL plus that key, and opens that link only. The links a Member sees them under, the Personal Links in their dialog and the links that open for them are the same. On another link of the Project they are not recognised; naming themselves there with their address mails them its Personal Link and, once it went out, puts them on it. A Member puts a Reviewer on another link, or takes them off one, from the Reviewer's dialog and the link's settings, and every Reviewer of the Project is listed, on a link or not, so that a replaced link is handed out again with or without an address (story 55). This replaces ADR 0013's Personal Link through every link of the Member on the Project. A Reviewer's own rights (comment, comment on older Versions, Watermark) belong to each link they are on.

A key per link keeps an address from being a way in. Nothing checks the address a Reviewer types when they name themselves; with one key per Reviewer, whoever typed someone else's address would have been handed every link the Member later invited that address on. With a key per link, an invitation's Personal Link goes only to the address invited or to the Member, whoever named themselves with that address before.

## Considered Options

- Dropping rights of a Reviewer's own, since the invitation dialog makes a link of their own for each person: a Reviewer barred from commenting on a shared link would have been allowed again.
- Keeping them per Reviewer: the second link could not allow what the first did not.
- Assets picked per Reviewer instead of per link: link and Reviewer would both narrow what is shown, and ADR 0010 would no longer say what a link shows.
- One key per Reviewer, renewed when an invitation meets an address the Reviewer typed themselves: it needs to know who gave an address, and a Reviewer would lose their saved Personal Links whenever that happens. A key per link needs neither; what it costs is that a browser that knows a Reviewer on one link does not know them on their others.

## Consequences

- The migrations copy each Reviewer's own rights to every link they were on, so that nothing changes on those, and put them on every link the activity shows they opened, so that nobody loses a link they used; a link they never opened no longer opens for them. Each of those links takes the key the Reviewer had, so every Personal Link sent before keeps working; links they are put on from then on get keys of their own. A removed Reviewer is marked as such instead of by a missing key.
- Deleting a link takes everyone off it, with their keys and rights there; the Reviewers and their Comments stay.
- Mails to a Reviewer carry the Personal Link of whichever of their links shows what they are about, so on more than one link a Reviewer cannot change their own name or address; the Member does, in their dialog. Otherwise whoever holds one key could send the others to another mailbox.
- An invitation on a link the Reviewer is on already gives that link a new key, so that whoever named themselves there with the address keeps none of it.
- Two Reviewers who share an address from before stay as they are; the rule holds for every new invitation, naming and change of address.
- A new Reviewer still needs a name nobody in the review has when a Member invites them (story 53); an invitation with a known address adds a link to that Reviewer instead, under the name they have. Reviewers who name themselves may still share a name, told apart by their colour.
- An existing Reviewer keeps an address they share with another from before; only a change to an address someone else has is refused.
- "Per Member and Project" is superseded by ADR 0017: an address is one Reviewer per Project, whichever Member invited them, and the Project's Members with Share manage them all.
