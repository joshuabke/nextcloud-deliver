/**
 * Tracks whether a tap on a BottomSheet began on its backdrop strip, so the
 * click that follows closes the sheet without letting that click reach what
 * lies under it (#298), while the release of a long press that opened the
 * sheet does not close it.
 *
 * Because the sheet panel slides up on open (`deliver-sheet-in`, 0.2 s), a
 * quick tap whose press landed on the strip can have its click land on the
 * moving panel instead (#315). Capturing the click on the backdrop closes the
 * sheet and stops it from triggering an item that slid under the finger.
 *
 * @return {{press: (onStrip: boolean) => void, cancel: () => void, click: (click: {onStrip: boolean, detail: number}) => boolean}} the strip-tap tracker
 */
export function sheetTap() {
	let downOnStrip = false

	return {
		/** @param {boolean} onStrip - whether the pointer went down on the backdrop itself */
		press(onStrip) {
			downOnStrip = onStrip
		},
		/** The pointer was cancelled (e.g. a scroll or system gesture): no click will follow */
		cancel() {
			downOnStrip = false
		},
		/**
		 * @param {{onStrip: boolean, detail: number}} click - where the click landed and its click count (0 for keyboard)
		 * @return {boolean} true when this click closes the sheet and must be swallowed
		 */
		click({ onStrip, detail }) {
			if (!downOnStrip) {
				return false
			}
			downOnStrip = false
			// A keyboard click (Enter/Space) on a focused item inside the panel has no pointer press behind it
			return onStrip || detail !== 0
		},
	}
}
