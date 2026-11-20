import { describe, expect, it } from 'vitest'
import { SKIP_SECONDS, skipFrames } from './skip.js'

describe('skipFrames', () => {
	it('turns seconds into Frames at the rate of the Version', () => {
		expect(skipFrames(SKIP_SECONDS, 25)).toBe(250)
		expect(skipFrames(-SKIP_SECONDS, 24)).toBe(-240)
		expect(skipFrames(SKIP_SECONDS, 30000 / 1001)).toBe(300)
		expect(skipFrames(-5, 25)).toBe(-125)
	})
})
