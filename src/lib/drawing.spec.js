import { describe, expect, it } from 'vitest'
import { containedBox, drawingsAt, keeps, shapePath } from './drawing.js'

describe('drawing', () => {
	it('finds where a contained picture sits', () => {
		const close = (box, expected) => Object.entries(expected).forEach(([key, value]) => expect(box[key]).toBeCloseTo(value, 6))
		close(containedBox(1920, 1080, 1000, 1000), { left: 0, top: 218.75, width: 1000, height: 562.5 })
		close(containedBox(1080, 1920, 1000, 500), { left: 359.375, top: 0, width: 281.25, height: 500 })
	})

	it('draws boxes, arrows and strokes in screen pixels', () => {
		expect(shapePath({ tool: 'box', points: [[0.1, 0.1], [0.5, 0.5]] }, 100, 200)).toBe('M10.0 20.0H50.0V100.0H10.0Z')
		expect(shapePath({ tool: 'pen', points: [[0, 0], [1, 1]] }, 10, 10)).toBe('M0.0 0.0L10.0 10.0')
		expect(shapePath({ tool: 'arrow', points: [[0, 0.5], [1, 0.5]] }, 100, 100)).toMatch(/^M0\.0 50\.0L100\.0 50\.0M/)
	})

	it('keeps a stroke point only once the pen moved', () => {
		expect(keeps([], [0, 0])).toBe(true)
		expect(keeps([[0, 0]], [0.001, 0])).toBe(false)
		expect(keeps([[0, 0]], [0.01, 0])).toBe(true)
	})

	it('shows the drawings of Comments on the Frame or around it', () => {
		const shapes = [{ tool: 'pen', color: '#ff0000', points: [[0, 0]] }]
		const comments = [
			{ id: 1, inFrame: 10, outFrame: null, annotation: shapes },
			{ id: 2, inFrame: 5, outFrame: 20, annotation: shapes },
			{ id: 3, inFrame: 10, outFrame: null, annotation: null },
		]
		expect(drawingsAt(comments, 10).map((c) => c.id)).toEqual([1, 2])
		expect(drawingsAt(comments, 11).map((c) => c.id)).toEqual([2])
	})
})
