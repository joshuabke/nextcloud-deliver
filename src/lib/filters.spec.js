import { describe, expect, it } from 'vitest'
import { found, passes } from './filters.js'

const version = (fields = {}) => ({ name: 'cut_v2.mov', seen: true, unseen: 0, approvals: { approved: 0, changes: 0 }, ...fields })
const asset = (fields = {}, versions = [version()]) => ({ name: 'Cut', dueDate: null, versions, ...fields })

describe('filters', () => {
	it('finds Unseen Versions and Unseen Comments anywhere in the Stack', () => {
		expect(passes(asset(), 'unseen')).toBe(false)
		expect(passes(asset({}, [version({ seen: false })]), 'unseen')).toBe(true)
		expect(passes(asset({}, [version(), version({ unseen: 2 })]), 'unseen')).toBe(true)
	})

	it('lets requested changes outweigh approvals', () => {
		const both = asset({ dueDate: '2030-01-01' }, [version({ approvals: { approved: 2, changes: 1 } })])
		expect([passes(both, 'changes'), passes(both, 'approved'), passes(both, 'due')]).toEqual([true, false, true])
		const through = asset({ dueDate: '2030-01-01' }, [version({ approvals: { approved: 1, changes: 0 } })])
		expect([passes(through, 'approved'), passes(through, 'due')]).toEqual([true, false])
	})

	it('searches the Asset name and the newest file name', () => {
		expect(found(asset(), ' cut ')).toBe(true)
		expect(found(asset(), 'V2.MOV')).toBe(true)
		expect(found(asset(), 'teaser')).toBe(false)
		expect(found(asset(), '')).toBe(true)
	})
})
