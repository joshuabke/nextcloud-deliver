import { ref, watch } from 'vue'
import { readGridOptions, readLayout, writeGridOptions, writeLayout } from '../lib/listView.js'

/**
 * Cards or compact rows for the Assets of one Project or Review Link,
 * remembered in this browser under that scope (not in the address, not on the server).
 *
 * @param {() => string} scope - 'project-12' or 'link-<token>'; read again when it changes
 * @return {import('vue').Ref<'grid'|'list'>}
 */
export function useLayout(scope) {
	const layout = ref(readLayout(scope()))
	watch(scope, (now) => {
		layout.value = readLayout(now)
	})
	watch(layout, (value) => writeLayout(scope(), value))
	return layout
}

/**
 * Grid display options (size, aspect ratio, thumbnail fit, title lines, card info, collapsed folders)
 * remembered in this browser per Project or Review Link in `deliver.grid.<scope>` beside `deliver.layout.<scope>`.
 *
 * @param {() => string} scope - 'project-12' or 'link-<token>'; read again when it changes
 * @return {import('vue').Ref<{size: 's'|'m'|'l', aspect: 'landscape'|'square'|'portrait', fit: 'fit'|'fill', titleLines: 1|2, info: boolean, collapseFolders: boolean}>}
 */
export function useGridOptions(scope) {
	const options = ref(readGridOptions(scope()))
	let loading = false
	watch(scope, (now) => {
		loading = true
		options.value = readGridOptions(now)
		loading = false
	}, { flush: 'sync' })
	watch(options, (value) => {
		if (!loading) {
			writeGridOptions(scope(), value)
		}
	}, { deep: true, flush: 'sync' })
	return options
}
