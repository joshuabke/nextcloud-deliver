import { describe, expect, it } from 'vitest'
import {
	aspectSpec,
	cardMinWidth,
	decisionOf,
	GRID_DEFAULTS,
	gridColumns,
	gridStyle,
	mediaFit,
	readGridOptions,
	readLayout,
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
		expect(readGridOptions('project-1', memory())).toEqual({
			size: 'm',
			aspect: 'landscape',
			fit: 'fit',
			titleLines: 2,
			info: true,
			collapseFolders: false,
		})
	})

	it('are remembered per Project and per link beside deliver.layout.<scope>', () => {
		const storage = memory()
		writeLayout('project-1', 'grid', storage)
		const custom = {
			size: 's',
			aspect: 'portrait',
			fit: 'fill',
			titleLines: 3,
			info: false,
			collapseFolders: true,
		}
		writeGridOptions('project-1', custom, storage)
		expect(readLayout('project-1', storage)).toBe('grid')
		expect(readGridOptions('project-1', storage)).toEqual(custom)
		expect(readGridOptions('project-2', storage)).toEqual(GRID_DEFAULTS)
		expect(readGridOptions('link-abc', storage)).toEqual(GRID_DEFAULTS)
	})

	it('fall back per field when storage holds unknown values', () => {
		const storage = memory()
		storage().setItem('deliver.layout.project-1.size', 'xl')
		storage().setItem('deliver.layout.project-1.aspect', 'cinema')
		storage().setItem('deliver.layout.project-1.fit', 'stretch')
		storage().setItem('deliver.layout.project-1.titleLines', '5')
		storage().setItem('deliver.layout.project-1.info', 'maybe')
		storage().setItem('deliver.layout.project-1.collapseFolders', '1')
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

describe('grid sizing and card styling', () => {
	it('gives two columns at medium size on a 393 px phone (361 px grid), three at S and one at L', () => {
		const phoneGrid = 393 - 32
		expect(gridColumns(phoneGrid, cardMinWidth('s', { mobile: true }), 8)).toBe(3)
		expect(gridColumns(phoneGrid, cardMinWidth('m', { mobile: true }), 8)).toBe(2)
		expect(gridColumns(phoneGrid, cardMinWidth('l', { mobile: true }), 8)).toBe(1)
		// Also on a Review Link's wider gap
		expect(gridColumns(phoneGrid, cardMinWidth('s', { mobile: true }), 16)).toBe(3)
		expect(gridColumns(phoneGrid, cardMinWidth('m', { mobile: true }), 16)).toBe(2)
		expect(gridColumns(phoneGrid, cardMinWidth('l', { mobile: true }), 16)).toBe(1)
	})

	it('keeps the desktop defaults at 220 px (Project) and 260 px (Review Link), scaling S and L around them', () => {
		expect(cardMinWidth('m')).toBe(220)
		expect(cardMinWidth('s')).toBeLessThan(220)
		expect(cardMinWidth('l')).toBeGreaterThan(220)
		expect(cardMinWidth('m', { wide: true })).toBe(260)
		expect(cardMinWidth('s', { wide: true })).toBeLessThan(260)
		expect(cardMinWidth('l', { wide: true })).toBeGreaterThan(260)
	})

	it('maps thumbnail fit/fill and aspect ratios to CSS properties', () => {
		expect(mediaFit('fit')).toBe('contain')
		expect(mediaFit('fill')).toBe('cover')
		expect(aspectSpec('landscape')).toEqual({ ratio: '16 / 9', heightFactor: 9 / 16 })
		expect(aspectSpec('square')).toEqual({ ratio: '1 / 1', heightFactor: 1 })
		expect(aspectSpec('portrait')).toEqual({ ratio: '9 / 16', heightFactor: 16 / 9 })
		expect(gridStyle({ size: 'l', aspect: 'square', titleLines: 1 }, { mobile: true })).toEqual({
			'--deliver-grid-min': '260px',
			'--deliver-still-ratio': '1 / 1',
			'--deliver-still-h': '1',
			'--deliver-title-lines': '1',
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
