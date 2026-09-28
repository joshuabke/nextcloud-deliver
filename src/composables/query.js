import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * A setting kept in the address, so the way back from a Review keeps it.
 * The default leaves the address clean.
 *
 * @param {string} key - the query parameter
 * @param {string[]|null} allowed - the values it may take, or null for any text
 * @param {string} fallback - the value when the address has none
 * @return {import('vue').WritableComputedRef<string>}
 */
export function useQuery(key, allowed, fallback) {
	const route = useRoute()
	const router = useRouter()
	return computed({
		get: () => {
			const value = route.query[key] ?? fallback
			return allowed === null || allowed.includes(value) ? value : fallback
		},
		set: (value) => router.replace({ query: { ...route.query, [key]: value === fallback ? undefined : value } }),
	})
}
