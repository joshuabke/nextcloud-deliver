import { describe, expect, it } from 'vitest'
import { skipFrames } from './skip.js'

describe('skipFrames', () => {
	it('turns ten seconds into Frames at the rate of the Version', () => {
		expect(skipFrames(1, 25)).toBe(250)
		expect(skipFrames(-1, 24)).toBe(-240)
		expect(skipFrames(1, 30000 / 1001)).toBe(300)
	})
})
