import { n } from './l10n.js'

/** The two looks of the Assets of a Project or a Review Link: cards in a grid, or one compact row each */
export const LAYOUTS = ['grid', 'list']
/** Card sizes in the grid: small, medium (default) and large */
export const CARD_SIZES = ['s', 'm', 'l']
/** Still aspect ratios in the grid */
export const ASPECT_RATIOS = ['landscape', 'square', 'portrait']
/** How a card's still fits its frame: 'fit' shows it whole (letterboxed, the default), 'fill' crops to the card */
export const THUMBNAIL_FITS = ['fit', 'fill']
/** How many lines an Asset's name may take on a card */
export const TITLE_LINES = [1, 2, 3]

/** Defaults that match the cards as shipped, except the phone's two columns at medium size */
export const GRID_DEFAULTS = Object.freeze({
	size: 'm',
	aspect: 'landscape',
	fit: 'fit',
	titleLines: 2,
	info: true,
	collapseFolders: false,
})

const key = (scope) => `deliver.layout.${scope}`
const optionKey = (scope, name) => `deliver.layout.${scope}.${name}`

const MIN_WIDTHS = {
	mobile: { s: 100, m: 150, l: 260 },
	desktop: { s: 160, m: 220, l: 320 },
	wide: { s: 180, m: 260, l: 360 },
}

const ASPECTS = {
	landscape: { ratio: '16 / 9', heightFactor: 9 / 16 },
	square: { ratio: '1 / 1', heightFactor: 1 },
	portrait: { ratio: '9 / 16', heightFactor: 16 / 9 },
}

/**
 * What this browser remembers for a Project or a Review Link; the compact rows
 * until it was told otherwise, and where storage is closed or throws.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own; asked inside the try, as the accessor itself may throw
 * @return {'grid'|'list'}
 */
export function readLayout(scope, storage = () => globalThis.localStorage) {
	try {
		const value = storage().getItem(key(scope))
		return LAYOUTS.includes(value) ? value : 'list'
	} catch {
		return 'list'
	}
}

/**
 * @param {string} scope - as for readLayout
 * @param {'grid'|'list'} layout - the choice
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own; asked inside the try, as the accessor itself may throw
 */
export function writeLayout(scope, layout, storage = () => globalThis.localStorage) {
	try {
		storage().setItem(key(scope), layout)
	} catch {
		// The choice then lasts until the page is left
	}
}

/**
 * Reads a boolean option stored as '1' or '0', falling back when absent or invalid
 *
 * @param {string|null} value - what storage held
 * @param {boolean} fallback - the default
 * @return {boolean}
 */
function readFlag(value, fallback) {
	if (value === '1') {
		return true
	}
	if (value === '0') {
		return false
	}
	return fallback
}

/**
 * The grid display options remembered in this browser for a Project or Review Link,
 * stored beside `deliver.layout.<scope>`. Missing, unknown or unreadable keys fall back to GRID_DEFAULTS.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own
 * @return {{size: 's'|'m'|'l', aspect: 'landscape'|'square'|'portrait', fit: 'fit'|'fill', titleLines: 1|2|3, info: boolean, collapseFolders: boolean}}
 */
export function readGridOptions(scope, storage = () => globalThis.localStorage) {
	try {
		const store = storage()
		const size = store.getItem(optionKey(scope, 'size'))
		const aspect = store.getItem(optionKey(scope, 'aspect'))
		const fit = store.getItem(optionKey(scope, 'fit'))
		const titleLines = Number(store.getItem(optionKey(scope, 'titleLines')))
		return {
			size: CARD_SIZES.includes(size) ? size : GRID_DEFAULTS.size,
			aspect: ASPECT_RATIOS.includes(aspect) ? aspect : GRID_DEFAULTS.aspect,
			fit: THUMBNAIL_FITS.includes(fit) ? fit : GRID_DEFAULTS.fit,
			titleLines: TITLE_LINES.includes(titleLines) ? titleLines : GRID_DEFAULTS.titleLines,
			info: readFlag(store.getItem(optionKey(scope, 'info')), GRID_DEFAULTS.info),
			collapseFolders: readFlag(store.getItem(optionKey(scope, 'collapseFolders')), GRID_DEFAULTS.collapseFolders),
		}
	} catch {
		return { ...GRID_DEFAULTS }
	}
}

/**
 * Writes the grid display options beside `deliver.layout.<scope>`.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {{size: string, aspect: string, fit: string, titleLines: number, info: boolean, collapseFolders: boolean}} options - the choices
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own
 */
export function writeGridOptions(scope, options, storage = () => globalThis.localStorage) {
	try {
		const store = storage()
		store.setItem(optionKey(scope, 'size'), CARD_SIZES.includes(options.size) ? options.size : GRID_DEFAULTS.size)
		store.setItem(optionKey(scope, 'aspect'), ASPECT_RATIOS.includes(options.aspect) ? options.aspect : GRID_DEFAULTS.aspect)
		store.setItem(optionKey(scope, 'fit'), THUMBNAIL_FITS.includes(options.fit) ? options.fit : GRID_DEFAULTS.fit)
		store.setItem(optionKey(scope, 'titleLines'), String(TITLE_LINES.includes(options.titleLines) ? options.titleLines : GRID_DEFAULTS.titleLines))
		store.setItem(optionKey(scope, 'info'), options.info ? '1' : '0')
		store.setItem(optionKey(scope, 'collapseFolders'), options.collapseFolders ? '1' : '0')
	} catch {
		// The choices then last until the page is left
	}
}

/**
 * Minimum CSS track width (px) for a card size. On a phone (393 px screen, ~361 px grid)
 * S gives 3 columns, M gives 2 and L gives 1; on a desktop M keeps 220 px (260 px on a Review Link).
 *
 * @param {'s'|'m'|'l'} size - the chosen card size
 * @param {{mobile?: boolean, wide?: boolean}} [surface] - phone vs desktop, and wider cards on a Review Link
 * @return {number} pixels
 */
export function cardMinWidth(size, { mobile = false, wide = false } = {}) {
	const table = mobile ? MIN_WIDTHS.mobile : wide ? MIN_WIDTHS.wide : MIN_WIDTHS.desktop
	return table[size] ?? table.m
}

/**
 * Column count CSS `repeat(auto-fill, minmax(min(minWidth, 100%), 1fr))` produces for a grid of `width` px.
 *
 * @param {number} width - inner width of the grid in pixels
 * @param {number} minWidth - minimum track width in pixels
 * @param {number} [gap] - column gap in pixels
 * @return {number} columns, at least 1
 */
export function gridColumns(width, minWidth, gap = 8) {
	if (width <= 0 || minWidth <= 0) {
		return 1
	}
	return Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
}

/**
 * CSS aspect-ratio and height-to-width factor (for positioning the card's menu button below the still).
 *
 * @param {'landscape'|'square'|'portrait'} aspect - the chosen aspect ratio
 * @return {{ratio: string, heightFactor: number}}
 */
export function aspectSpec(aspect) {
	return ASPECTS[aspect] ?? ASPECTS.landscape
}

/**
 * Maps the display setting ('fit' / 'fill') to MediaStill's `fit` prop ('contain' / 'cover').
 *
 * @param {'fit'|'fill'} fit - the thumbnail setting
 * @return {'contain'|'cover'}
 */
export function mediaFit(fit) {
	return fit === 'fill' ? 'cover' : 'contain'
}

/**
 * CSS custom properties applied to a card grid from its display options.
 *
 * @param {{size: string, aspect: string, titleLines: number}} options - the grid display options
 * @param {{mobile?: boolean, wide?: boolean}} [surface] - phone vs desktop, and wider cards on a Review Link
 * @return {Record<string, string>}
 */
export function gridStyle(options, surface = {}) {
	const spec = aspectSpec(options.aspect)
	return {
		'--deliver-grid-min': `${cardMinWidth(options.size, surface)}px`,
		'--deliver-still-ratio': spec.ratio,
		'--deliver-still-h': String(spec.heightFactor),
		'--deliver-title-lines': String(TITLE_LINES.includes(options.titleLines) ? options.titleLines : GRID_DEFAULTS.titleLines),
	}
}

/**
 * Requested changes outweigh approvals: the newest Version is not through while anyone wants changes (story 88)
 *
 * @param {{approved?: number, changes?: number}} approvals - the counts on the newest Version
 * @return {{kind: 'changes'|'approved', text: string}|null}
 */
export function decisionOf({ approved = 0, changes = 0 }) {
	if (changes > 0) {
		return { kind: 'changes', text: n('deliver', '%n requests changes', '%n request changes', changes) }
	}
	return approved > 0 ? { kind: 'approved', text: n('deliver', 'Approved by %n', 'Approved by %n', approved) } : null
}
