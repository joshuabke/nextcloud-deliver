import { describe, expect, it } from 'vitest'
import { inTurnQueue } from './inTurn.js'

describe('inTurnQueue', () => {
	it('runs tasks one at a time, in order, also after one failed', async () => {
		const inTurn = inTurnQueue()
		const log = []
		const slow = inTurn(async () => {
			log.push('a start')
			await new Promise((resolve) => setTimeout(resolve, 20))
			log.push('a end')
			throw new Error('a failed')
		})
		const next = inTurn(async () => {
			log.push('b')
			return 'b'
		})
		await expect(slow).rejects.toThrow('a failed')
		await expect(next).resolves.toBe('b')
		expect(log).toEqual(['a start', 'a end', 'b'])
	})
})
