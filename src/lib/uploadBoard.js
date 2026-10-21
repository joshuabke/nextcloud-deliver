/**
 * The upload card of every tab (stories 134 and 135): what this tab sends,
 * what other tabs send, uploads that stopped, and finished ones whose
 * Processing is still shown. Free of the store and of localStorage, so Vitest
 * can check it.
 */
import { sentElsewhere } from './upload.js'

/** Statuses of an upload that is still going on in this tab */
export const ACTIVE = ['waiting', 'uploading', 'finishing', 'paused']
/** Statuses of an upload this tab only shows: another tab sends it, or it stopped and waits for its file */
export const MIRRORED = ['elsewhere', 'interrupted']

/**
 * Takes in what every tab keeps. Mirrored uploads keep their objects, so a
 * dialog that holds one, picking its file again, still holds the one listed.
 *
 * @param {object[]} items - the list now
 * @param {object[]} records - the uploads every tab sends, or sent until it stopped
 * @param {Array<{versionId: number}>} done - finished uploads still shown
 * @param {number} now - the time
 * @param {() => number} newId - an id for an entry new to the list
 * @return {{items: object[], added: object[]}} the list, and the finished uploads new to it, to read at once
 */
export function mergeBoard(items, records, done, now, newId) {
	// This tab's own uploads, finished ones aside, are its own to show
	const own = new Set(items.filter((item) => !MIRRORED.includes(item.status) && item.status !== 'done').map((item) => item.target))
	const shown = new Map()
	for (const record of records.filter((each) => !own.has(each.target))) {
		const live = sentElsewhere(record, now)
		// A file sent in one piece cannot be gone on with once its tab is gone
		if (live || record.folder) {
			shown.set(record.target, { ...record, phase: live ? record.status : null, status: live ? 'elsewhere' : 'interrupted', loaded: live ? record.loaded ?? 0 : 0 })
		}
	}
	const versions = new Set(done.map((each) => each.versionId))
	const kept = []
	for (const item of items) {
		if (MIRRORED.includes(item.status)) {
			// Without a record it was finished or cancelled, or its tab went away with nothing to go on with
			if (shown.has(item.target)) {
				kept.push(Object.assign(item, shown.get(item.target), { id: item.id }))
				shown.delete(item.target)
			}
		} else if (item.status !== 'done' || !item.version || versions.has(item.version.id)) {
			// A finished one gone from the list was hidden in another tab
			kept.push(item)
		}
	}
	for (const fields of shown.values()) {
		kept.push({ ...fields, id: newId(), fileId: null, error: null, version: null, waveform: null, file: null })
	}
	const added = done
		.filter((one) => !kept.some((item) => item.version?.id === one.versionId))
		.map((one) => ({ id: newId(), name: one.name, size: one.size, projectId: one.projectId, assetId: one.assetId, status: 'done', loaded: one.size, error: null, version: { id: one.versionId }, waveform: null, file: null }))
	return { items: [...kept, ...added], added }
}

/**
 * @param {object[]} items - the list
 * @param {number} speed - this tab's speed, in bytes per second
 * @return {{total: number, loaded: number, speed: number, percent: number, eta: ?number}} the queue of every tab: bytes to send and sent, the speeds together, and the seconds left
 */
export function totals(items, speed) {
	const sending = items.filter((item) => ACTIVE.includes(item.status) || item.status === 'elsewhere')
	const total = sending.reduce((sum, item) => sum + item.size, 0)
	const loaded = sending.reduce((sum, item) => sum + item.loaded, 0)
	const together = speed + sending.reduce((sum, item) => sum + (item.status === 'elsewhere' ? item.speed ?? 0 : 0), 0)
	return { total, loaded, speed: together, percent: total ? Math.floor(loaded / total * 100) : 100, eta: together > 0 ? (total - loaded) / together : null }
}
