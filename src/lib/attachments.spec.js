import { describe, expect, it } from 'vitest'
import { fitting } from './attachments.js'

describe('fitting', () => {
	const mb = (n) => ({ size: n * 1024 * 1024, name: `${n} MB` })
	const limit = 20 * 1024 * 1024

	it('counts what is attached already', () => {
		expect(fitting([mb(10)], 15 * 1024 * 1024, limit).left).toEqual([mb(10)])
		expect(fitting([mb(5)], 15 * 1024 * 1024, limit).fit).toEqual([mb(5)])
	})

	it('adds the picked files up in their order, and later small ones still fit', () => {
		const { fit, left } = fitting([mb(8), mb(8), mb(8), mb(2)], 0, limit)
		expect(fit).toEqual([mb(8), mb(8), mb(2)])
		expect(left).toEqual([mb(8)])
	})
})
