import { describe, expect, it } from 'vitest'
import { allMissing, between, found, passes, projectPasses, selectAll, sortAssets, sortProjects } from './filters.js'

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

	it('finds what I delivered by the newest Version', () => {
		const mine = { type: 'user', id: 'anna', name: 'Anna' }
		const older = version({ deliveredBy: mine })
		const newer = version({ deliveredBy: { type: 'user', id: 'ben', name: 'Ben' } })
		expect(passes(asset({}, [version({ deliveredBy: mine })]), 'mine', 'anna')).toBe(true)
		expect(passes(asset({}, [newer, older]), 'mine', 'anna')).toBe(false)
		expect(passes(asset({}, [version({ deliveredBy: null })]), 'mine', 'anna')).toBe(false)
		expect(passes(asset({}, [version({ deliveredBy: null })]), 'mine', '')).toBe(false)
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

	it('filters and sorts Projects by what waits in them', () => {
		const project = (name, createdAt, activity) => ({ name, createdAt, activity: { unseenComments: 0, changes: 0, nextDue: null, lastActivity: 0, ...activity } })
		const quiet = project('Archiv', 1, { lastActivity: 5 })
		const busy = project('Kampagne', 3, { unseenComments: 2, lastActivity: 9, nextDue: '2030-03-01' })
		const late = project('Imagefilm', 2, { changes: 1, lastActivity: 7, nextDue: '2030-01-01' })
		expect([quiet, busy, late].filter((each) => projectPasses(each, 'unseen'))).toEqual([busy])
		expect([quiet, busy, late].filter((each) => projectPasses(each, 'due'))).toEqual([busy, late])
		const names = (sort) => sortProjects([quiet, busy, late], sort).map((each) => each.name)
		expect(names('activity')).toEqual(['Kampagne', 'Imagefilm', 'Archiv'])
		expect(names('created')).toEqual(['Kampagne', 'Imagefilm', 'Archiv'])
		expect(names('due')).toEqual(['Imagefilm', 'Kampagne', 'Archiv'])
		expect(names('name')).toEqual(['Archiv', 'Imagefilm', 'Kampagne'])
	})
})

describe('ticking Assets', () => {
	const missing = asset({ name: 'gone' }, [version({ state: 'missing' })])
	const half = asset({ name: 'half' }, [version({ state: 'missing' }), version({ state: 'ready' })])

	it('counts an Asset as Missing only when every file of it is', () => {
		expect([allMissing(missing), allMissing(half)]).toEqual([true, false])
	})

	it('selects the Assets with files, or the Missing ones when there are no others', () => {
		expect(selectAll([missing, half]).map((each) => each.name)).toEqual(['half'])
		expect(selectAll([missing]).map((each) => each.name)).toEqual(['gone'])
	})

	it('takes every Asset between the one ticked last and the one shift-clicked, either way round', () => {
		const row = [1, 2, 3, 4].map((id) => ({ id }))
		expect(between(row, 2, 4).map((each) => each.id)).toEqual([2, 3, 4])
		expect(between(row, 4, 1).map((each) => each.id)).toEqual([1, 2, 3, 4])
		expect(between(row, 9, 3).map((each) => each.id)).toEqual([3])
	})
})
