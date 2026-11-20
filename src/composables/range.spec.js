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
		expect(marks.wrapFrom(41)).toBeNull()
		marks.loop.value = true
		expect(marks.loopsWhole.value).toBe(false)
		expect(marks.wrapFrom(40)).toBeNull()
		expect(marks.wrapFrom(41)).toBe(10)
		marks.clearRange()
		expect(marks.loop.value).toBe(false)
		marks.loop.value = true
		expect(marks.loopsWhole.value).toBe(true)
		expect(marks.wrapFrom(1000)).toBeNull()
	})
})
