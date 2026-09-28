<script setup>
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import allIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import linkIcon from '@mdi/svg/svg/link-variant.svg?raw'
import { showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { listProjectShares } from '../api.js'
import { folderTree } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const route = useRoute()
const router = useRouter()
/** My Share Links in this Project that have review on */
const links = ref([])

const project = computed(() => store.details[props.id])
const folders = computed(() => folderTree(project.value?.assets ?? []))
const current = computed(() => route.query.folder ?? '')

watch(() => props.id, async (id) => {
	links.value = []
	const all = await listProjectShares(id).catch(() => [])
	if (props.id === id) {
		links.value = all.filter((share) => share.review)
	}
}, { immediate: true })

/**
 * @param {string} folder - a folder of the Project, '' for all of it
 */
function open(folder) {
	router.replace({ query: { ...route.query, folder: folder || undefined } })
}

/**
 * @param {object} share - a Share Link
 * @return {string} Files with the share settings of the link's file or folder open
 */
function manageUrl(share) {
	return generateUrl('/apps/files/files/{fileId}', { fileId: share.fileId }) + '?' + new URLSearchParams({ dir: share.dir, opendetails: 'true' })
}

/**
 * @param {object} share - a Share Link
 */
async function copy(share) {
	await navigator.clipboard.writeText(share.url)
	showSuccess(t('deliver', 'Link copied'))
}
</script>

<template>
	<NcAppNavigation :aria-label="t('deliver', 'Folders and Share Links')">
		<template #list>
			<NcAppNavigationItem
				:name="t('deliver', 'All Assets')"
				:active="current === ''"
				@click="open('')">
				<template #icon>
					<NcIconSvgWrapper :svg="allIcon" />
				</template>
				<template #counter>
					{{ project?.assets.length }}
				</template>
			</NcAppNavigationItem>
			<NcAppNavigationItem
				v-for="folder in folders"
				:key="folder.path"
				:name="folder.name"
				:title="folder.path"
				:active="current === folder.path"
				:style="{ paddingInlineStart: `${folder.depth * 16}px` }"
				@click="open(folder.path)">
				<template #icon>
					<NcIconSvgWrapper :svg="folderIcon" />
				</template>
				<template #counter>
					{{ folder.count }}
				</template>
			</NcAppNavigationItem>

			<NcAppNavigationCaption :name="t('deliver', 'Share Links')" />
			<li v-if="links.length === 0" class="deliver-navigation__hint">
				{{ t('deliver', 'No Share Link with review yet. Create one in the Deliver tab of the Files sidebar.') }}
			</li>
			<NcAppNavigationItem
				v-for="share in links"
				:key="share.id"
				:name="share.label || share.name"
				:title="share.url"
				:href="manageUrl(share)">
				<template #icon>
					<NcIconSvgWrapper :svg="linkIcon" />
				</template>
				<template #actions>
					<NcActionButton @click="copy(share)">
						{{ t('deliver', 'Copy link') }}
					</NcActionButton>
					<NcActionLink :href="manageUrl(share)">
						{{ t('deliver', 'Manage in Files') }}
					</NcActionLink>
				</template>
			</NcAppNavigationItem>
		</template>
	</NcAppNavigation>
</template>

<style scoped>
.deliver-navigation__hint {
	padding: 0 calc(3 * var(--default-grid-baseline, 4px));
	color: var(--color-text-maxcontrast);
}
</style>
