import { describe, expect, it } from 'vitest'
import { liveSeek } from './liveSeek.js'

describe('liveSeek', () => {
	it('seeks at once, then holds the latest wish until the seek settles', () => {
		const seen = []
		const seeker = liveSeek((frame) => {
			seen.push(frame)
		})
		seeker.want(1)
		seeker.want(2)
		seeker.want(3)
		expect(seen).toEqual([1])
		seeker.settled()
		expect(seen).toEqual([1, 3])
		seeker.settled()
		expect(seen).toEqual([1, 3])
		seeker.want(4)
		expect(seen).toEqual([1, 3, 4])
	})

	it('awaits nothing when the seek started none', () => {
		const seen = []
		const seeker = liveSeek((frame) => {
			seen.push(frame)
			return false
		})
		seeker.want(1)
		seeker.want(2)
		expect(seen).toEqual([1, 2])
	})

	it('forgets a waiting wish on reset', () => {
		const seen = []
		const seeker = liveSeek((frame) => {
			seen.push(frame)
		})
		seeker.want(1)
		seeker.want(2)
		seeker.reset()
		seeker.settled()
		expect(seen).toEqual([1])
	})
})
