import { describe, expect, it } from 'vitest'
import {
	aspectSpec,
	decisionOf,
	GRID_DEFAULTS,
	gridStyle,
	mediaFit,
	readGridOptions,
	readLayout,
	TITLE_LINES,
	writeGridOptions,
	writeLayout,
} from './listView.js'

function memory() {
	const map = new Map()
	const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
	return () => storage
}
function refuse() {
	throw new Error('closed')
}
const closed = refuse

describe('the remembered layout', () => {
	it('is the list until chosen', () => {
		expect(readLayout('project-1', memory())).toBe('list')
	})

	it('is kept per Project and per link', () => {
		const storage = memory()
		writeLayout('project-1', 'grid', storage)
		expect(readLayout('project-1', storage)).toBe('grid')
		expect(readLayout('project-2', storage)).toBe('list')
		expect(readLayout('link-abc', storage)).toBe('list')
		writeLayout('project-1', 'list', storage)
		expect(readLayout('project-1', storage)).toBe('list')
	})

	it('ignores what is not a layout', () => {
		const storage = memory()
		storage().setItem('deliver.layout.project-1', 'tiles')
		expect(readLayout('project-1', storage)).toBe('list')
	})

	it('survives a storage that throws', () => {
		expect(() => writeLayout('project-1', 'grid', closed)).not.toThrow()
		expect(readLayout('project-1', closed)).toBe('list')
	})
})

describe('grid display options', () => {
	it('start at the defaults that match the shipped cards', () => {
		expect(TITLE_LINES).toEqual([1, 2])
		expect(readGridOptions('project-1', memory())).toEqual({
			size: 'm',
			aspect: 'landscape',
			fit: 'fit',
			titleLines: 2,
			info: true,
			collapseFolders: false,
		})
	})

	it('are remembered per Project and per link in one JSON key beside deliver.layout.<scope>', () => {
		const storage = memory()
		writeLayout('project-1', 'grid', storage)
		const custom = {
			size: 's',
			aspect: 'portrait',
			fit: 'fill',
			titleLines: 1,
			info: false,
			collapseFolders: true,
		}
		writeGridOptions('project-1', custom, storage)
		expect(readLayout('project-1', storage)).toBe('grid')
		expect(JSON.parse(storage().getItem('deliver.grid.project-1'))).toEqual(custom)
		expect(readGridOptions('project-1', storage)).toEqual(custom)
		expect(readGridOptions('project-2', storage)).toEqual(GRID_DEFAULTS)
		expect(readGridOptions('link-abc', storage)).toEqual(GRID_DEFAULTS)
	})

	it('fall back to defaults on garbage JSON or unknown field values', () => {
		const storage = memory()
		storage().setItem('deliver.grid.project-1', '{not json')
		expect(readGridOptions('project-1', storage)).toEqual(GRID_DEFAULTS)

		storage().setItem('deliver.grid.project-1', JSON.stringify({
			size: 'xl',
			aspect: 'cinema',
			fit: 'stretch',
			titleLines: 3,
			info: 'maybe',
			collapseFolders: true,
		}))
		expect(readGridOptions('project-1', storage)).toEqual({
			...GRID_DEFAULTS,
			collapseFolders: true,
		})
	})

	it('survive a storage that throws', () => {
		expect(() => writeGridOptions('project-1', { ...GRID_DEFAULTS, size: 'l' }, closed)).not.toThrow()
		expect(readGridOptions('project-1', closed)).toEqual(GRID_DEFAULTS)
	})
})

describe('card styling helpers', () => {
	it('maps thumbnail fit/fill and aspect ratios to CSS properties', () => {
		expect(mediaFit('fit')).toBe('contain')
		expect(mediaFit('fill')).toBe('cover')
		expect(aspectSpec('landscape')).toEqual({ ratio: '16 / 9', heightFactor: 9 / 16 })
		expect(aspectSpec('square')).toEqual({ ratio: '1 / 1', heightFactor: 1 })
		expect(aspectSpec('portrait')).toEqual({ ratio: '9 / 16', heightFactor: 16 / 9 })
		expect(gridStyle({ aspect: 'square' })).toEqual({
			'--deliver-still-ratio': '1 / 1',
			'--deliver-still-h': '1',
		})
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
