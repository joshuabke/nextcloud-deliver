/**
 * Drawings on a Frame (story 89). Points run from 0 to 1 across the picture,
 * so a drawing fits the picture at any size; these helpers turn them into
 * SVG in the pixels on screen.
 */

export const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff']

/**
 * Where a picture of one size sits inside a box when it is contained and centred.
 *
 * @param {number} pictureWidth - the video's own width
 * @param {number} pictureHeight - the video's own height
 * @param {number} boxWidth - the element's width
 * @param {number} boxHeight - the element's height
 * @return {{left: number, top: number, width: number, height: number}} the picture's rectangle in the box
 */
export function containedBox(pictureWidth, pictureHeight, boxWidth, boxHeight) {
	if (!pictureWidth || !pictureHeight) {
		return { left: 0, top: 0, width: boxWidth, height: boxHeight }
	}
	const scale = Math.min(boxWidth / pictureWidth, boxHeight / pictureHeight)
	const width = pictureWidth * scale
	const height = pictureHeight * scale
	return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height }
}

/**
 * @param {{tool: string, points: number[][]}} shape - a shape in picture coordinates
 * @param {number} width - the picture's width on screen
 * @param {number} height - the picture's height on screen
 * @return {string} an SVG path
 */
export function shapePath(shape, width, height) {
	const points = shape.points.map(([x, y]) => [x * width, y * height])
	const [from, to] = [points[0], points[points.length - 1]]
	const f = (n) => n.toFixed(1)
	if (shape.tool === 'box') {
		return `M${f(from[0])} ${f(from[1])}H${f(to[0])}V${f(to[1])}H${f(from[0])}Z`
	}
	if (shape.tool === 'arrow') {
		const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
		const head = Math.max(10, Math.min(28, Math.hypot(to[0] - from[0], to[1] - from[1]) / 4))
		const wing = (turn) => [to[0] - head * Math.cos(angle + turn), to[1] - head * Math.sin(angle + turn)]
		const [left, right] = [wing(Math.PI / 7), wing(-Math.PI / 7)]
		return `M${f(from[0])} ${f(from[1])}L${f(to[0])} ${f(to[1])}M${f(left[0])} ${f(left[1])}L${f(to[0])} ${f(to[1])}L${f(right[0])} ${f(right[1])}`
	}
	return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')
}

/**
 * A freehand stroke keeps a point only once the pen has moved on, so a slow
 * hand does not pile up thousands of them.
 *
 * @param {number[][]} points - the stroke so far
 * @param {number[]} point - the next point
 * @param {number} step - the least distance to keep a point, in picture coordinates
 * @return {boolean} whether to keep it
 */
export function keeps(points, point, step = 0.003) {
	const last = points[points.length - 1]
	return !last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= step
}

/**
 * @param {Array<object>} comments - top-level Comments
 * @param {number} frame - where the player stands
 * @return {Array<object>} those with a drawing on this Frame, or on a Range around it
 */
export function drawingsAt(comments, frame) {
	return comments.filter((comment) => comment.annotation?.length
		&& comment.inFrame <= frame
		&& frame <= (comment.outFrame ?? comment.inFrame))
}
