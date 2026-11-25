import { describe, expect, it } from 'vitest'
import { stackSuggestions } from './suggestions.js'
import { nextNumber, parseVersionName, versionFileName, versionNames } from './versionName.js'

describe('filename convention', () => {
	it('reads what the server reads', () => {
		expect(parseVersionName('cut_v3.mp4')).toEqual({ base: 'cut', number: 3 })
		expect(parseVersionName('final cut v12.mov')).toEqual({ base: 'final cut', number: 12 })
		expect(parseVersionName('cut.mp4')).toBeNull()
		expect(parseVersionName('cut_v0.mp4')).toBeNull()
	})
})

describe('a new Version\'s file whose name is taken', () => {
	it('gets its number appended, before the extension', () => {
		expect(versionFileName('mix.mp3', 2)).toBe('mix_v2.mp3')
		expect(versionFileName('mix.final.wav', 3)).toBe('mix.final_v3.wav')
		expect(versionFileName('mix', 2)).toBe('mix_v2')
		expect(versionFileName('v2.mp4', 3)).toBe('v2_v3.mp4')
	})

	it('gives up the version suffix it has, whose spelling stays', () => {
		expect(versionFileName('mix_v2.mp3', 3)).toBe('mix_v3.mp3')
		expect(versionFileName('final cut v12.mov', 13)).toBe('final cut v13.mov')
		expect(versionFileName('cut-V03.mov', 4)).toBe('cut-V04.mov')
	})

	it('reads as that Version of the same name', () => {
		for (const name of ['mix.mp3', 'mix_v1.mp3', 'mix v9.mp3', 'mix-v007.mp3']) {
			expect(parseVersionName(versionFileName(name, 12))).toEqual({ base: 'mix', number: 12 })
		}
	})

	it('counts as the server does: one above the highest, gaps and all', () => {
		expect(nextNumber([{ number: 5 }, { number: 1 }])).toBe(6)
		expect(nextNumber([])).toBe(1)
	})

	it('tries the number the server counts now, then the next ones, and asks only once', async () => {
		let asked = 0
		const next = versionNames('mix.mp3', async () => {
			asked++
			return [{ number: 3 }, { number: 1 }]
		})
		expect([await next(), await next(), await next(), asked]).toEqual(['mix_v4.mp3', 'mix_v5.mp3', 'mix_v6.mp3', 1])
	})

	it('still finds a name when the Version it asks by is gone', async () => {
		const next = versionNames('mix.mp3', () => Promise.reject(new Error('404')))
		expect([await next(), await next()]).toEqual(['mix_v2.mp3', 'mix_v3.mp3'])
	})
})

const TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg' }
const asset = (id, name, file, path = '', mimeType = TYPES[file.split('.').pop()]) => ({ id, name, path, versions: [{ name: file, mimeType }] })

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

	it('keeps kinds of media apart, but not containers', () => {
		const assets = [asset(1, 'cut', 'cut.mp4'), asset(2, 'cut', 'cut.mov'), asset(3, 'cut', 'cut_v2.mp3'), asset(4, 'cut', 'cut_v3.mp4')]
		expect(stackSuggestions(assets).get(4).map((a) => a.id)).toEqual([1, 2])
		expect(stackSuggestions(assets).has(3)).toBe(false)
	})

	it('still offers an Asset whose files are Missing', () => {
		const assets = [asset(1, 'cut', 'cut.mp4', '', null), asset(2, 'cut', 'cut.mov'), asset(3, 'cut', 'cut_v2.mp4')]
		expect(stackSuggestions(assets).get(3).map((a) => a.id)).toEqual([1, 2])
	})

	it('says nothing for a Missing file, whose kind is unknown', () => {
		expect(stackSuggestions([asset(1, 'cut', 'cut.mp4'), asset(2, 'cut', 'cut_v2.mp4', '', null)]).size).toBe(0)
	})

	it('says nothing about an Asset that is already a Stack', () => {
		const stacked = { id: 3, name: 'cut', path: '', versions: [{ name: 'cut_v2.mp4' }, { name: 'cut.mp4' }] }
		expect(stackSuggestions([asset(1, 'cut', 'cut.mp4'), stacked]).size).toBe(0)
	})
})
