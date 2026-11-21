import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useRange } from './range.js'

describe('useRange', () => {
	it('marks in and out at the Frame the player stands on, an out before the in moving the in', () => {
		const frame = ref(10)
		const marks = useRange(frame)
		marks.markIn()
		frame.value = 40
		marks.markOut()
		expect(marks.range.value).toEqual({ inFrame: 10, outFrame: 40 })
		// An in after the out drops the out
		frame.value = 50
		marks.markIn()
		expect(marks.range.value).toEqual({ inFrame: 50, outFrame: null })
		// An out without an in starts the Range there too
		marks.clearRange()
		frame.value = 5
		marks.markOut()
		expect(marks.range.value).toEqual({ inFrame: 5, outFrame: 5 })
	})

	it('loops back to the in Frame only past the out Frame and only while Loop is on', () => {
		const frame = ref(10)
		const marks = useRange(frame)
		marks.markIn()
		frame.value = 40
		marks.markOut()
		expect(marks.wrapFrom(41, 25)).toBeNull()
		marks.loop.value = true
		expect(marks.loopsWhole.value).toBe(false)
		expect(marks.wrapFrom(40, 25)).toBeNull()
		expect(marks.wrapFrom(41, 25)).toBe(10)
		marks.clearRange()
		expect(marks.loop.value).toBe(false)
		marks.loop.value = true
		expect(marks.loopsWhole.value).toBe(true)
		expect(marks.wrapFrom(1000, 25)).toBeNull()
	})

	it('does not loop a Range shorter than a tenth of a second, which would buzz', () => {
		const frame = ref(100)
		const marks = useRange(frame)
		marks.markOut()
		marks.loop.value = true
		expect(marks.wrapFrom(101, 25)).toBeNull()
		// Two Frames at 25 fps are 80 ms; three are 120
		frame.value = 101
		marks.markOut()
		expect(marks.wrapFrom(102, 25)).toBeNull()
		frame.value = 102
		marks.markOut()
		expect(marks.wrapFrom(103, 25)).toBe(100)
		// Audio counts Frames in milliseconds
		expect(marks.wrapFrom(103, 1000)).toBeNull()
	})
})
