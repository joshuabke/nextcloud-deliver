import { describe, expect, it } from 'vitest'
import { approveLocked, clampSwitches, shareLocked } from './access.js'

const row = (over) => ({ owner: false, canShare: true, level: 'comment', share: false, approve: false, ...over })
const all = { share: true, approve: true }
const nothing = { share: false, approve: false }

describe('clampSwitches', () => {
	it('turns Share and Approve off on None', () => {
		expect(clampSwitches({ level: 'none', share: true, approve: true })).toEqual({ level: 'none', share: false, approve: false })
	})

	it('turns Approve off on View, keeps Share', () => {
		expect(clampSwitches({ level: 'view', share: true, approve: true })).toEqual({ level: 'view', share: true, approve: false })
	})

	it('keeps both on Comment and Manage', () => {
		for (const level of ['comment', 'manage']) {
			expect(clampSwitches({ level, share: true, approve: true })).toEqual({ level, share: true, approve: true })
		}
	})

	it('does not touch its argument', () => {
		const next = { level: 'none', share: true, approve: true }
		clampSwitches(next)
		expect(next.share).toBe(true)
	})
})

describe('shareLocked', () => {
	it('is free for a Member who may share, on a level that sees the Project', () => {
		expect(shareLocked(row(), all)).toBeNull()
	})

	it('locks the owner, a row Files does not let share, and None', () => {
		expect(shareLocked(row({ owner: true }), all)).not.toBeNull()
		expect(shareLocked(row({ canShare: false }), all)).not.toBeNull()
		expect(shareLocked(row({ level: 'none' }), all)).not.toBeNull()
	})

	it('locks giving what I lack, but lets me take it away', () => {
		expect(shareLocked(row(), nothing)).not.toBeNull()
		expect(shareLocked(row({ share: true }), nothing)).toBeNull()
	})
})

describe('approveLocked', () => {
	it('is free on Comment and Manage', () => {
		expect(approveLocked(row(), all)).toBeNull()
		expect(approveLocked(row({ level: 'manage' }), all)).toBeNull()
	})

	it('locks the owner, None and View', () => {
		expect(approveLocked(row({ owner: true }), all)).not.toBeNull()
		expect(approveLocked(row({ level: 'none' }), all)).not.toBeNull()
		expect(approveLocked(row({ level: 'view' }), all)).not.toBeNull()
	})

	it('locks giving what I lack, but lets me take it away', () => {
		expect(approveLocked(row(), nothing)).not.toBeNull()
		expect(approveLocked(row({ approve: true }), nothing)).toBeNull()
	})
})
