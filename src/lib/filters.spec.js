import { describe, expect, it } from 'vitest'
import { found, passes, sortAssets } from './filters.js'

const version = (fields = {}) => ({ name: 'cut_v2.mov', unseen: 0, approvals: { approved: 0, changes: 0 }, ...fields })
const asset = (fields = {}, versions = [version()]) => ({ name: 'Cut', dueDate: null, versions, ...fields })

describe('filters', () => {
	it('finds Unseen Comments anywhere in the Stack', () => {
		expect(passes(asset(), 'unseen')).toBe(false)
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

	it('sorts by activity, name, arrival and Due Date', () => {
		const a = { name: 'b-roll', createdAt: 10, lastActivity: 50, dueDate: null }
		const b = { name: 'Anna', createdAt: 30, lastActivity: 40, dueDate: '2030-02-01' }
		const c = { name: 'cut', createdAt: 20, lastActivity: 60, dueDate: '2030-01-01' }
		const names = (sort) => sortAssets([a, b, c], sort).map((each) => each.name)
		expect(names('activity')).toEqual(['cut', 'b-roll', 'Anna'])
		expect(names('name')).toEqual(['Anna', 'b-roll', 'cut'])
		expect(names('created')).toEqual(['Anna', 'cut', 'b-roll'])
		expect(names('due')).toEqual(['cut', 'Anna', 'b-roll'])
	})
})
