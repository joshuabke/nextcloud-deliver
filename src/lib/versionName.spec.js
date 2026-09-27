import { describe, expect, it } from 'vitest'
import { stackSuggestions } from './suggestions.js'
import { parseVersionName } from './versionName.js'

describe('filename convention', () => {
	it('reads what the server reads', () => {
		expect(parseVersionName('cut_v3.mp4')).toEqual({ base: 'cut', number: 3 })
		expect(parseVersionName('final cut v12.mov')).toEqual({ base: 'final cut', number: 12 })
		expect(parseVersionName('cut.mp4')).toBeNull()
		expect(parseVersionName('cut_v0.mp4')).toBeNull()
	})
})

const asset = (id, name, file, path = '') => ({ id, name, path, versions: [{ name: file }] })

describe('stack suggestions', () => {
	it('offers the Assets a name points at when Deliver did not dare to stack', () => {
		const assets = [asset(1, 'cut', 'cut.mp4'), asset(2, 'cut', 'cut.mov'), asset(3, 'cut', 'cut_v2.mp4')]
		expect([...stackSuggestions(assets).keys()]).toEqual([3])
		expect(stackSuggestions(assets).get(3).map((a) => a.id)).toEqual([1, 2])
	})

	it('stays quiet when there is nothing to join', () => {
		expect(stackSuggestions([asset(1, 'cut', 'cut_v2.mp4')]).size).toBe(0)
		expect(stackSuggestions([asset(1, 'cut', 'cut.mp4'), asset(2, 'teaser', 'teaser_v2.mp4')]).size).toBe(0)
	})

	it('keeps folders apart', () => {
		const assets = [asset(1, 'cut', 'cut.mp4', 'scenes'), asset(2, 'cut', 'cut_v2.mp4', '')]
		expect(stackSuggestions(assets).size).toBe(0)
	})

	it('says nothing about an Asset that is already a Stack', () => {
		const stacked = { id: 3, name: 'cut', path: '', versions: [{ name: 'cut_v2.mp4' }, { name: 'cut.mp4' }] }
		expect(stackSuggestions([asset(1, 'cut', 'cut.mp4'), stacked]).size).toBe(0)
	})
})
