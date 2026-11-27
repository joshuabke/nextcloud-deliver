import { describe, expect, it } from 'vitest'
import { sheetTap } from './sheetTap.js'

describe('sheetTap', () => {
	it('closes on a click after a press on the strip, once', () => {
		const tap = sheetTap()
		tap.press(true)
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(true)
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(false)
	})

	it('still closes if the sliding panel moves under the finger before the click arrives (#315)', () => {
		const tap = sheetTap()
		tap.press(true)
		expect(tap.click({ onStrip: false, detail: 1 })).toBe(true)
	})

	it('ignores the release of a long press that opened the sheet (#298)', () => {
		const tap = sheetTap()
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(false)
	})

	it('does not close on a press inside the panel, and clears any earlier strip press', () => {
		const tap = sheetTap()
		tap.press(true)
		tap.press(false)
		expect(tap.click({ onStrip: false, detail: 1 })).toBe(false)
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(false)
	})

	it('forgets a strip press after pointercancel or before a keyboard activation inside the panel', () => {
		const tap = sheetTap()
		tap.press(true)
		tap.cancel()
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(false)

		tap.press(true)
		expect(tap.click({ onStrip: false, detail: 0 })).toBe(false)
		expect(tap.click({ onStrip: true, detail: 1 })).toBe(false)
	})
})
