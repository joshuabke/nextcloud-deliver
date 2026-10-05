import { mediaKind, stackKind } from './media.js'
import { parseVersionName } from './versionName.js'

/**
 * Stacks a filename suggests but Deliver did not make, because more than one
 * Asset matched (spec: Discovery and stacking): an Asset with a single
 * Version whose name carries a Version Number, and the Assets of that base
 * name in the same folder and of the same kind of media. Derived from what
 * is on screen, so it cannot go stale.
 *
 * @param {Array<object>} assets - the Assets of one Project
 * @return {Map<number, Array<object>>} Asset id → the Assets it could join
 */
export function stackSuggestions(assets) {
	const suggestions = new Map()
	for (const asset of assets) {
		if (asset.versions.length !== 1) {
			continue
		}
		const parsed = parseVersionName(asset.versions[0].name)
		if (parsed === null) {
			continue
		}
		const kind = mediaKind(asset.versions[0].mimeType)
		const candidates = assets.filter((other) => other.id !== asset.id
			&& other.path === asset.path
			&& other.name.toLowerCase() === parsed.base.toLowerCase()
			// A Stack of Missing files only has no known kind, which does not rule it out
			&& kind !== null && (stackKind(other.versions) ?? kind) === kind)
		if (candidates.length > 0) {
			suggestions.set(asset.id, candidates)
		}
	}
	return suggestions
}
