import { describe, expect, it } from 'vitest'
import { isOriginal } from './original.js'

const version = { fileSize: 1000, fileModified: 1700000000 }

describe('isOriginal', () => {
	it('takes a local file of the same size and time', () => {
		expect(isOriginal({ size: 1000, lastModified: 1700000000_000 }, version)).toBe(true)
		expect(isOriginal({ size: 1000, lastModified: 1700000002_900 }, version)).toBe(true)
	})

	it('refuses another size or a time more than two seconds off', () => {
		expect(isOriginal({ size: 999, lastModified: 1700000000_000 }, version)).toBe(false)
		expect(isOriginal({ size: 1000, lastModified: 1700000003_000 }, version)).toBe(false)
		expect(isOriginal({ size: 1000, lastModified: 1699999997_000 }, version)).toBe(false)
	})

	it('refuses everything while the Version has no size or time to compare', () => {
		expect(isOriginal({ size: 1000, lastModified: 1700000000_000 }, { fileSize: null, fileModified: null })).toBe(false)
	})
})
