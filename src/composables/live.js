import { listen } from '@nextcloud/notify_push'

let listening = false

/**
 * Asks for changes as soon as the server says there are some (story 96),
 * where Nextcloud runs notify_push; the regular poll stays as the fallback.
 * Push reaches accounts only, so the public page keeps polling.
 *
 * @param {object} store - the Comments store
 */
export function useLiveUpdates(store) {
	if (listening) {
		return
	}
	listening = true
	listen('deliver_changed', (name, body) => {
		if (body?.versionId === store.versionId) {
			store.poll()
		}
	})
}
