import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { actionFor, closesDialog } from './hotkeys.js'

const key = (init) => ({ ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, isComposing: false, repeat: false, target: { tagName: 'BODY' }, ...init })

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

	it('skips with Shift and the arrows', () => {
		expect(actionFor(key({ key: 'ArrowRight', shiftKey: true }))).toBe('skipForward')
		expect(actionFor(key({ key: 'ArrowLeft', shiftKey: true }))).toBe('skipBack')
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

describe('closesDialog', () => {
	it('closes a dialog on Escape from fields that NcModal hotkeys ignore (#306)', () => {
		for (const target of [
			{ tagName: 'INPUT' },
			{ tagName: 'TEXTAREA' },
			{ tagName: 'SELECT' },
			{ tagName: 'DIV', isContentEditable: true },
		]) {
			expect(closesDialog(key({ key: 'Escape', target }))).toBe(true)
		}
	})

	it('leaves non-field targets to NcModal itself', () => {
		expect(closesDialog(key({ key: 'Escape', target: { tagName: 'BUTTON' } }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: { tagName: 'DIV' } }))).toBe(false)
	})

	it('ignores Escape that was already handled, modified, composing or repeated', () => {
		const input = { tagName: 'INPUT' }
		expect(closesDialog(key({ key: 'Escape', target: input, defaultPrevented: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: input, isComposing: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: input, repeat: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: input, ctrlKey: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: input, metaKey: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Escape', target: input, altKey: true }))).toBe(false)
		expect(closesDialog(key({ key: 'Enter', target: input }))).toBe(false)
	})

	it('routes every NcDialog in src/ through DeliverDialog', () => {
		const direct = []
		const walk = (dir) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name)
				if (entry.isDirectory()) {
					walk(full)
				} else if (entry.name.endsWith('.vue') && entry.name !== 'DeliverDialog.vue') {
					if (readFileSync(full, 'utf8').includes('@nextcloud/vue/components/NcDialog')) {
						direct.push(full)
					}
				}
			}
		}
		walk(join(import.meta.dirname, '..'))
		expect(direct).toEqual([])
	})
})
