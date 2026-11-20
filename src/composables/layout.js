import { ref, watch } from 'vue'
import { readLayout, writeLayout } from '../lib/listView.js'

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
