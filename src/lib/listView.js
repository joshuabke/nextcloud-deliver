import { n } from './l10n.js'

/** The two looks of the Assets of a Project or a Review Link: cards in a grid, or one compact row each */
export const LAYOUTS = ['grid', 'list']
/** Card sizes in the grid: small, medium (default) and large */
export const CARD_SIZES = ['s', 'm', 'l']
/** Still aspect ratios in the grid */
export const ASPECT_RATIOS = ['landscape', 'square', 'portrait']
/** How a card's still fits its frame: 'fit' shows it whole (letterboxed, the default), 'fill' crops to the card */
export const THUMBNAIL_FITS = ['fit', 'fill']
/** How many lines an Asset's name may take on a card (matches NameText) */
export const TITLE_LINES = [1, 2]

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
const gridKey = (scope) => `deliver.grid.${scope}`

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
 * Normalises a raw options object, falling back per field to GRID_DEFAULTS
 *
 * @param {unknown} raw - parsed JSON or caller options
 * @return {{size: 's'|'m'|'l', aspect: 'landscape'|'square'|'portrait', fit: 'fit'|'fill', titleLines: 1|2, info: boolean, collapseFolders: boolean}}
 */
function normaliseGridOptions(raw) {
	if (!raw || typeof raw !== 'object') {
		return { ...GRID_DEFAULTS }
	}
	return {
		size: CARD_SIZES.includes(raw.size) ? raw.size : GRID_DEFAULTS.size,
		aspect: ASPECT_RATIOS.includes(raw.aspect) ? raw.aspect : GRID_DEFAULTS.aspect,
		fit: THUMBNAIL_FITS.includes(raw.fit) ? raw.fit : GRID_DEFAULTS.fit,
		titleLines: TITLE_LINES.includes(raw.titleLines) ? raw.titleLines : GRID_DEFAULTS.titleLines,
		info: typeof raw.info === 'boolean' ? raw.info : GRID_DEFAULTS.info,
		collapseFolders: typeof raw.collapseFolders === 'boolean' ? raw.collapseFolders : GRID_DEFAULTS.collapseFolders,
	}
}

/**
 * The grid display options remembered in this browser for a Project or Review Link,
 * stored as JSON in `deliver.grid.<scope>` beside `deliver.layout.<scope>`.
 * Missing, unreadable or invalid fields fall back to GRID_DEFAULTS.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own
 * @return {{size: 's'|'m'|'l', aspect: 'landscape'|'square'|'portrait', fit: 'fit'|'fill', titleLines: 1|2, info: boolean, collapseFolders: boolean}}
 */
export function readGridOptions(scope, storage = () => globalThis.localStorage) {
	try {
		const raw = storage().getItem(gridKey(scope))
		return raw ? normaliseGridOptions(JSON.parse(raw)) : { ...GRID_DEFAULTS }
	} catch {
		return { ...GRID_DEFAULTS }
	}
}

/**
 * Writes the grid display options as JSON in `deliver.grid.<scope>`.
 *
 * @param {string} scope - 'project-12' or 'link-<token>'
 * @param {{size: string, aspect: string, fit: string, titleLines: number, info: boolean, collapseFolders: boolean}} options - the choices
 * @param {() => Storage} [storage] - gives localStorage, unless a test brings its own
 */
export function writeGridOptions(scope, options, storage = () => globalThis.localStorage) {
	try {
		storage().setItem(gridKey(scope), JSON.stringify(normaliseGridOptions(options)))
	} catch {
		// The choices then last until the page is left
	}
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
 * CSS custom properties applied to a card grid for its chosen aspect ratio.
 *
 * @param {{aspect: string}} options - the grid display options
 * @return {Record<string, string>}
 */
export function gridStyle(options) {
	const spec = aspectSpec(options.aspect)
	return {
		'--deliver-still-ratio': spec.ratio,
		'--deliver-still-h': String(spec.heightFactor),
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
