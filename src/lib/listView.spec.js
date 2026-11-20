import { describe, expect, it } from 'vitest'
import { decisionOf, readLayout, writeLayout } from './listView.js'

function memory() {
	const map = new Map()
	return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}
function refuse() {
	throw new Error('closed')
}
const closed = { getItem: refuse, setItem: refuse }

describe('the remembered layout', () => {
	it('is the grid until chosen', () => {
		expect(readLayout('project-1', memory())).toBe('grid')
	})

	it('is kept per Project and per link', () => {
		const storage = memory()
		writeLayout('project-1', 'list', storage)
		expect(readLayout('project-1', storage)).toBe('list')
		expect(readLayout('project-2', storage)).toBe('grid')
		expect(readLayout('link-abc', storage)).toBe('grid')
	})

	it('ignores what is not a layout', () => {
		const storage = memory()
		storage.setItem('deliver.layout.project-1', 'tiles')
		expect(readLayout('project-1', storage)).toBe('grid')
	})

	it('survives a storage that throws', () => {
		expect(() => writeLayout('project-1', 'list', closed)).not.toThrow()
		expect(readLayout('project-1', closed)).toBe('grid')
	})
})

describe('the decision on a Version', () => {
	it('lets requested changes outweigh approvals', () => {
		expect(decisionOf({ approved: 2, changes: 1 }).kind).toBe('changes')
	})

	it('is approved with approvals only, and none without any', () => {
		expect(decisionOf({ approved: 1, changes: 0 }).kind).toBe('approved')
		expect(decisionOf({ approved: 0, changes: 0 })).toBeNull()
	})
})
