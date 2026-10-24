import { n, t } from '@nextcloud/l10n'

/**
 * A Review Link's title: its label, else what it shows, since the people it
 * was made for are listed under it (story 145).
 *
 * @param {{label: ?string, assetIds: ?number[]}} link - a Review Link
 * @param {Array<{id: number, name: string}>} assets - the Assets it may show, to name its one Asset
 * @return {string} the label, "Whole Project", its one Asset's name, or how many Assets
 */
export function linkTitle(link, assets) {
	if (link.label) {
		return link.label
	}
	if (link.assetIds === null) {
		return t('deliver', 'Whole Project')
	}
	const only = link.assetIds.length === 1 ? assets.find((asset) => asset.id === link.assetIds[0]) : null
	return only?.name ?? n('deliver', '%n Asset', '%n Assets', link.assetIds.length)
}
