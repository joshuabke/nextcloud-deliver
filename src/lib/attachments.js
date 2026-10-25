/**
 * Which picked files still fit into what one person may attach on a Version
 * (story 92), taken in the order they were picked.
 *
 * @param {Array<{size: number}>} picked - the files picked
 * @param {number} used - bytes the person attached on the Version already, those waiting to be sent included
 * @param {number} limit - what the server allows in all, in bytes
 * @return {{fit: Array<{size: number}>, left: Array<{size: number}>}} the files that fit and those that do not
 */
export function fitting(picked, used, limit) {
	const fit = []
	const left = []
	let total = used
	for (const file of picked) {
		if (total + file.size <= limit) {
			fit.push(file)
			total += file.size
		} else {
			left.push(file)
		}
	}
	return { fit, left }
}
