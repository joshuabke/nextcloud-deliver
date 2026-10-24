/**
 * Whom the invite form's name field suggests (stories 142, 145): the
 * Project's Reviewers who match first, as giving one of them another link is
 * the usual case, then the Member's contacts, each address once (ADR 0014).
 *
 * @param {string} typed - what the name field holds
 * @param {Array<{name: string, email: string}>} reviewers - the Project's Reviewers with an address
 * @param {Array<{name: string, email: string, photo: ?string}>} contacts - the contacts the server found
 * @return {Array<{name: string, email: string, photo: ?string, reviewer: boolean}>} the rows to offer
 */
export function peopleToSuggest(typed, reviewers, contacts) {
	const term = typed.trim().toLowerCase()
	const photos = new Map(contacts.map((contact) => [contact.email.toLowerCase(), contact.photo]))
	const matching = reviewers.filter((person) => person.name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term))
	const known = new Set(matching.map((person) => person.email.toLowerCase()))
	return [
		...matching.map((person) => ({ ...person, photo: photos.get(person.email.toLowerCase()) ?? null, reviewer: true })),
		...contacts.filter((contact) => !known.has(contact.email.toLowerCase())).map((contact) => ({ ...contact, reviewer: false })),
	]
}
