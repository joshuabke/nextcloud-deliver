/**
 * Contacts suggested in the invite form's name field (story 142): a native
 * datalist only hands back the option's text, so each address gets a label
 * of its own that leads back to name and address.
 *
 * @param {Array<{name: string, email: string}>} found - the contacts the server found, one per address
 * @return {Array<{name: string, email: string, label: string}>} the options to offer
 */
export function contactOptions(found) {
	return found.map((each) => ({ ...each, label: `${each.name} <${each.email}>` }))
}

/**
 * @param {Array<{name: string, email: string, label: string}>} options - the options offered
 * @param {string} typed - what the name field holds now
 * @return {{name: string, email: string}|null} the contact picked, if the field holds an option's label
 */
export function pickedContact(options, typed) {
	const picked = options.find((each) => each.label === typed)
	return picked ? { name: picked.name, email: picked.email } : null
}
