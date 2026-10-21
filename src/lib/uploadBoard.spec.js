import { describe, expect, it } from 'vitest'
import { HEARTBEAT } from './upload.js'
import { mergeBoard, totals } from './uploadBoard.js'

const now = Date.UTC(2026, 9, 21)
const record = (fields = {}) => ({ name: 'cut.mov', size: 100, target: '/cut.mov', folder: null, loaded: 40, status: 'uploading', speed: 10, seen: now - 1000, left: false, ...fields })
let ids = 100
const merge = (items, records, done = []) => mergeBoard(items, records, done, now, () => ids++)

describe('the upload card of every tab', () => {
	it('shows what another tab sends, as that tab does', () => {
		const { items } = merge([], [record()])
		expect(items).toMatchObject([{ status: 'elsewhere', phase: 'uploading', loaded: 40, speed: 10 }])
	})

	it('lets go of an upload whose tab stopped touching it: a chunked one waits for its file, one in one piece goes', () => {
		const stale = now - 4 * HEARTBEAT
		const shown = merge([], [record({ seen: stale, target: '/a', folder: '/up/1' }), record({ seen: stale, target: '/b' })]).items
		expect(shown.map((item) => [item.target, item.status])).toEqual([['/a', 'interrupted']])
	})

	it('takes an upload off once its record is gone, and keeps the object a dialog may hold', () => {
		const mirrored = merge([], [record({ target: '/a' }), record({ target: '/b' })]).items
		const [first] = mirrored
		const after = merge(mirrored, [record({ target: '/a', loaded: 60 })]).items
		expect(after).toHaveLength(1)
		expect(after[0]).toBe(first)
		expect(after[0].loaded).toBe(60)
	})

	it('leaves this tab its own uploads, failed ones too, without a mirrored copy', () => {
		const own = { id: 1, target: '/cut.mov', status: 'failed', error: 'taken' }
		expect(merge([own], [record()]).items).toEqual([own])
	})

	it('shows finished uploads of every tab until one tab hides them', () => {
		const { items, added } = merge([], [], [{ versionId: 7, name: 'cut.mov', size: 100 }])
		expect(added).toHaveLength(1)
		expect(items).toMatchObject([{ status: 'done', version: { id: 7 } }])
		expect(merge(items, [], []).items).toEqual([])
	})

	it('adds up the queue of every tab with their speeds', () => {
		const items = [{ status: 'uploading', size: 100, loaded: 50 }, { status: 'elsewhere', size: 100, loaded: 0, speed: 25 }, { status: 'done', size: 100, loaded: 100 }]
		expect(totals(items, 25)).toEqual({ total: 200, loaded: 50, speed: 50, percent: 25, eta: 3 })
	})
})
