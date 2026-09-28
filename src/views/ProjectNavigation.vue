<script setup>
import reviewerIcon from '@mdi/svg/svg/account-outline.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import allIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import linkIcon from '@mdi/svg/svg/link-variant.svg?raw'
import addIcon from '@mdi/svg/svg/plus.svg?raw'
import { showError, showSuccess } from '@nextcloud/dialogs'
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
import ShareLinkDialog from '../components/ShareLinkDialog.vue'
import { createShareLink, errorMessage, listProjectShares } from '../api.js'
import { folderTree } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const route = useRoute()
const router = useRouter()
/** My Share Links in this Project that have review on, each with the Project's Reviewers and their Personal Links */
const links = ref([])
/** The Share Link whose settings are open */
const editing = ref(null)

const project = computed(() => store.details[props.id])
const folders = computed(() => folderTree(project.value?.assets ?? []))
const current = computed(() => route.query.folder ?? '')

/**
 * @param {number} id - the Project
 */
async function load(id = props.id) {
	const all = await listProjectShares(id).catch(() => [])
	if (props.id === id) {
		links.value = all.filter((share) => share.review)
	}
}

watch(() => props.id, (id) => {
	links.value = []
	load(id)
}, { immediate: true })

/** A new Share Link on the Project folder, review on, its settings open (story 45) */
async function createLink() {
	try {
		const created = await createShareLink(project.value.folderId)
		await load()
		editing.value = links.value.find((share) => share.id === created.id) ?? null
	} catch (e) {
		showError(errorMessage(e))
	}
}

/**
 * @param {object} updated - the Share Link as the server returned it after a change
 */
function replace(updated) {
	editing.value = { ...editing.value, ...updated }
}

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
 * @param {string} link - a Share Link or a Personal Link
 */
async function copy(link) {
	await navigator.clipboard.writeText(link)
	showSuccess(t('deliver', 'Link copied'))
}

/** Invitations and switches made in the dialog show up in the list */
function closeEditing() {
	editing.value = null
	load()
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
				{{ t('deliver', 'No Share Link with review yet.') }}
			</li>
			<NcAppNavigationItem
				v-for="share in links"
				:key="share.id"
				:name="share.label || share.name"
				:title="share.url"
				:allowCollapse="share.reviewers.length > 0"
				:open="true"
				@click="editing = share">
				<template #icon>
					<NcIconSvgWrapper :svg="linkIcon" />
				</template>
				<template #actions>
					<NcActionButton @click="copy(share.url)">
						{{ t('deliver', 'Copy link') }}
					</NcActionButton>
					<NcActionButton @click="editing = share">
						{{ t('deliver', 'Link settings and Reviewers') }}
					</NcActionButton>
					<NcActionLink :href="manageUrl(share)">
						{{ t('deliver', 'Manage in Files') }}
					</NcActionLink>
				</template>
				<NcAppNavigationItem
					v-for="reviewer in share.reviewers"
					:key="reviewer.id"
					:name="reviewer.name"
					:title="t('deliver', 'Copy the Personal Link of {name}', { name: reviewer.name })"
					@click="copy(reviewer.link)">
					<template #icon>
						<NcIconSvgWrapper :svg="reviewerIcon" />
					</template>
					<template #actions>
						<NcActionButton @click="copy(reviewer.link)">
							{{ t('deliver', 'Copy Personal Link') }}
						</NcActionButton>
					</template>
				</NcAppNavigationItem>
			</NcAppNavigationItem>
			<NcAppNavigationItem
				v-if="project?.canWrite"
				:name="t('deliver', 'Create Review Link')"
				@click="createLink">
				<template #icon>
					<NcIconSvgWrapper :svg="addIcon" />
				</template>
			</NcAppNavigationItem>
		</template>
		<template #footer>
			<!-- The dialog renders over the page; it only lives here -->
			<ShareLinkDialog
				v-if="editing"
				:share="editing"
				:canWrite="project?.canWrite ?? false"
				@update="replace"
				@close="closeEditing" />
		</template>
	</NcAppNavigation>
</template>

<style scoped>
.deliver-navigation__hint {
	padding: 0 calc(3 * var(--default-grid-baseline, 4px));
	color: var(--color-text-maxcontrast);
}
</style>
