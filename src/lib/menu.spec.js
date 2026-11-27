import { describe, expect, it } from 'vitest'
import { groupItems } from './menu.js'

describe('the groups of a menu on a phone', () => {
	it('begins a group where an entry names another', () => {
		const items = [{ label: 'Open', group: 'open' }, { label: 'Compare' }, { label: 'Due Date', group: 'review' }, { label: 'Move' }]
		expect(groupItems(items).map((group) => group.map((item) => item.label))).toEqual([['Open', 'Compare'], ['Due Date', 'Move']])
	})

	it('keeps an entry without a group with the one before', () => {
		expect(groupItems([{ label: 'A' }, { label: 'B' }]).length).toBe(1)
	})

	it('puts the dangerous entries together last', () => {
		const items = [{ label: 'Open' }, { label: 'Remove', danger: true }, { label: 'Delete', danger: true }]
		expect(groupItems(items).map((group) => group.map((item) => item.label))).toEqual([['Open'], ['Remove', 'Delete']])
	})

	it('has no group without entries', () => {
		expect(groupItems([])).toEqual([])
	})
})
