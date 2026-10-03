/**
 * The Watermark over the picture on a Project Link (story 94): one line of
 * text, repeated diagonally as an SVG tile, so a screen recording carries it
 * wherever it is cropped.
 *
 * @param {string} text - who is watching, and when
 * @return {string} a CSS background-image value
 */
export function watermarkTile(text) {
	const escaped = text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200">'
		+ '<text x="180" y="100" text-anchor="middle" transform="rotate(-24 180 100)" '
		+ `font-family="sans-serif" font-size="18" font-weight="bold" fill="#fff" fill-opacity="0.22" stroke="#000" stroke-opacity="0.18" stroke-width="0.6">${escaped}</text></svg>`
	return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`
}
