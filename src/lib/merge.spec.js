import { describe, expect, it } from 'vitest'
import { mergeComments } from './merge.js'

const comment = (id, inFrame, body = 'x') => ({ id, inFrame, body, parentId: null })

describe('polling merge', () => {
	it('adds what is new and keeps Frame order', () => {
		const merged = mergeComments([comment(1, 100)], [comment(2, 50)], null)
		expect(merged.map((c) => c.id)).toEqual([2, 1])
	})

	it('replaces a Comment that changed', () => {
		const merged = mergeComments([comment(1, 100, 'old')], [comment(1, 100, 'new')], null)
		expect(merged).toHaveLength(1)
		expect(merged[0].body).toBe('new')
	})

	it('drops what someone else deleted', () => {
		const merged = mergeComments([comment(1, 10), comment(2, 20)], [], [2])
		expect(merged.map((c) => c.id)).toEqual([2])
	})

	it('keeps everything when no id list came with the answer', () => {
		const merged = mergeComments([comment(1, 10), comment(2, 20)], [], null)
		expect(merged).toHaveLength(2)
	})
})
