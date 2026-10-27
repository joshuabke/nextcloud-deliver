import { n, t } from './l10n.js'

/**
 * A Review Link's title: its label, else what it shows, since the people it
 * was made for are listed under it (story 145).
 *
 * @param {{label: ?string, assetIds: ?number[], assetName: ?string}} link - a Review Link, with the name of its one Asset
 * @return {string} the label, "Whole Project", its one Asset's name, or how many Assets
 */
export function linkTitle(link) {
	if (link.label) {
		return link.label
	}
	if (link.assetIds === null) {
		return t('deliver', 'Whole Project')
	}
	return link.assetName ?? n('deliver', '%n Asset', '%n Assets', link.assetIds.length)
}
