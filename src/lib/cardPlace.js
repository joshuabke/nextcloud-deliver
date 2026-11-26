/** The small card a Comment's circle opens (#273), in px: as wide as it likes to be, at least, its margin to the window's edges and its gap to the playhead */
export const CARD = { width: 264, least: 168, margin: 8, gap: 8 }

/**
 * Where across the window the card a circle opens stands: centred over the
 * circle, kept inside the window, and on a side of the playhead where that
 * runs through it (on the Waveform), on the circle's side if it has room
 * there, narrower where it must.
 *
 * @param {number} x - the circle's centre, in px from the window's left edge
 * @param {number} viewport - the window's width, in px
 * @param {?number} line - the playhead to keep clear of, in px from the window's left edge; null for none
 * @return {{left: number, width: number}} the card's left edge and its width, in px
 */
export function cardPlace(x, viewport, line = null) {
	const { width, least, margin, gap } = CARD
	let from = margin
	let to = viewport - margin
	if (line !== null) {
		const right = { from: Math.max(from, line + gap), to }
		const left = { from, to: Math.min(to, line - gap) }
		const side = (x >= line ? [right, left] : [left, right]).find((each) => each.to - each.from >= least)
		// A window too narrow for a card beside the playhead on either side: it is covered
		if (side) {
			({ from, to } = side)
		}
	}
	const wide = Math.min(width, to - from)
	return { left: Math.min(to - wide, Math.max(from, x - wide / 2)), width: wide }
}
