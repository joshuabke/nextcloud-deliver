import { describe, expect, it } from 'vitest'
import { actionFor } from './hotkeys.js'

const key = (init) => ({ ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY' }, ...init })

describe('hotkeys', () => {
	it('maps the transport keys of the spec', () => {
		expect(actionFor(key({ key: ' ' }))).toBe('playPause')
		expect(actionFor(key({ key: 'ArrowRight' }))).toBe('stepForward')
		expect(actionFor(key({ key: ',' }))).toBe('stepBack')
		expect(actionFor(key({ key: 'J' }))).toBe('shuttleBack')
		expect(actionFor(key({ key: 'l' }))).toBe('shuttleForward')
		expect(actionFor(key({ key: 'I' }))).toBe('markIn')
		expect(actionFor(key({ key: 'o' }))).toBe('markOut')
		expect(actionFor(key({ key: 'c' }))).toBe('comment')
	})

	it('keeps out of the way while someone types', () => {
		expect(actionFor(key({ key: 'c', target: { tagName: 'TEXTAREA' } }))).toBeNull()
		expect(actionFor(key({ key: 'c', target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull()
	})

	it('leaves browser shortcuts alone', () => {
		expect(actionFor(key({ key: 'l', ctrlKey: true }))).toBeNull()
		expect(actionFor(key({ key: 'F5' }))).toBeNull()
	})
})
