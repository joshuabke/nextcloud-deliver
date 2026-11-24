import { describe, expect, it } from 'vitest'
import { freeName, nameProblem } from './uploadName.js'

/**
 * Nextcloud's own check, as far as it goes here
 *
 * @param {string} name - a filename
 */
function validate(name) {
	const segment = name.match(/[/?]/)?.[0]
	if (segment) {
		throw Object.assign(new Error('invalid'), { segment })
	}
}

/**
 * @param {...string} names - files of the folder
 * @return {(name: string) => Promise<boolean>} whether one is there
 */
const folder = (...names) => async (name) => names.includes(name)

describe('a free name for an upload', () => {
	it('is the first one free, counted from 2, with the extension as it was', async () => {
		expect(await freeName('mix.mp3', folder('mix.mp3'))).toBe('mix (2).mp3')
		expect(await freeName('mix.MP3', folder('mix.MP3', 'mix (2).MP3', 'mix (3).MP3'))).toBe('mix (4).MP3')
		expect(await freeName('cut.final.mov', folder())).toBe('cut.final (2).mov')
		expect(await freeName('mix', folder())).toBe('mix (2)')
	})

	it('ends where every name is taken, as a server answering anything with a page does', async () => {
		let asked = 0
		const always = async () => {
			if (++asked > 1000) {
				throw new Error('never ends')
			}
			return true
		}
		expect(await freeName('mix.mp3', always)).toMatch(/^mix \(\d+\)\.mp3$/)
		expect(asked).toBeLessThan(200)
	})

	it('counts on where the name is counted already', async () => {
		expect(await freeName('mix (2).mp3', folder('mix (2).mp3'))).toBe('mix (3).mp3')
	})
})

describe('a name typed for an upload', () => {
	it('keeps the extension', () => {
		expect(nameProblem('other.mp3', 'mix.mp3', validate)).toBeNull()
		expect(nameProblem('other.MP3', 'mix.mp3', validate)).toBeNull()
		for (const name of ['other.wav', 'other', '', '.mp3', ' .mp3']) {
			expect(nameProblem(name, 'mix.mp3', validate)).toBe('Keep the extension .mp3.')
		}
		expect(nameProblem('', 'mix', validate)).not.toBeNull()
	})

	it('has only what Nextcloud allows, named where it does not', () => {
		expect(nameProblem('a/b.mp3', 'mix.mp3', validate)).toContain('"/"')
		expect(nameProblem('why?.mp3', 'mix.mp3', validate)).toContain('"?"')
	})
})
