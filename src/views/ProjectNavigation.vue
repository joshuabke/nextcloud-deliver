<script setup>
import reviewerIcon from '@mdi/svg/svg/account-outline.svg?raw'
import copyIcon from '@mdi/svg/svg/content-copy.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import allIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import projectWideIcon from '@mdi/svg/svg/link-box-variant-outline.svg?raw'
import pausedIcon from '@mdi/svg/svg/link-variant-off.svg?raw'
import pickedIcon from '@mdi/svg/svg/playlist-check.svg?raw'
import addIcon from '@mdi/svg/svg/plus.svg?raw'
import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationCaption from '@nextcloud/vue/components/NcAppNavigationCaption'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import ReviewerDialog from '../components/ReviewerDialog.vue'
import ShareLinkDialog from '../components/ShareLinkDialog.vue'
import { createProjectLink, errorMessage, listProjectLinks, removeReviewer } from '../api.js'
import { copyLink } from '../clipboard.js'
import { confirmReviewerRemoval } from '../confirm.js'
import { folderTree } from '../lib/folders.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const store = useProjectsStore()
const route = useRoute()
const router = useRouter()
/** My Project Links on this Project, paused ones too */
const links = ref([])
/** The Project's Reviewers, each once, with their Personal Link through every review link */
const reviewers = ref([])
/** The link whose settings are open */
const editing = ref(null)
/** The Reviewer whose settings are open */
const person = ref(null)

const project = computed(() => store.details[props.id])
const folders = computed(() => folderTree(project.value?.assets ?? []))
const current = computed(() => route.query.folder ?? '')
const byId = computed(() => new Map(reviewers.value.map((reviewer) => [reviewer.id, reviewer])))

/**
 * @param {number} id - the Project
 */
async function load(id = props.id) {
	const found = await listProjectLinks(id).catch(() => ({ links: [], reviewers: [] }))
	if (props.id === id) {
		links.value = found.links.map((link, index) => ({ ...link, title: titleOf(link, index) }))
		reviewers.value = found.reviewers
		person.value = person.value && (byId.value.get(person.value.id) ?? null)
	}
}

/**
 * @param {object} link - a Project Link
 * @param {number} index - its place in the list
 * @return {string} its label, else the one Asset it shows, else a number
 */
function titleOf(link, index) {
	const only = link.assetIds?.length === 1 ? project.value?.assets.find((asset) => asset.id === link.assetIds[0]) : null
	return link.label || only?.name || (index === 0 ? t('deliver', 'Project Link') : t('deliver', 'Project Link {number}', { number: index + 1 }))
}

/**
 * @param {object} link - a Project Link
 * @return {string} whether it is paused or shows all or picked Assets
 */
function iconOf(link) {
	return !link.review ? pausedIcon : link.assetIds === null ? projectWideIcon : pickedIcon
}

watch(() => props.id, (id) => {
	links.value = []
	load(id)
}, { immediate: true })

/** A new Project Link showing the whole Project, live, its settings open (stories 45, 120) */
async function createLink() {
	try {
		const created = await createProjectLink(props.id)
		await load()
		editing.value = links.value.find((share) => share.token === created.token) ?? null
	} catch (e) {
		showError(errorMessage(e))
	}
}

/**
 * @param {object} updated - the link as the server returned it after a change
 */
function replace(updated) {
	editing.value = { ...editing.value, ...updated }
}

/**
 * From the Reviewer's dialog
 *
 * @param {object} reviewer - a Reviewer of the list
 */
async function dropReviewer(reviewer) {
	if (await confirmReviewerRemoval(reviewer.name)) {
		try {
			await removeReviewer(reviewer.id)
			person.value = null
			await load()
		} catch (e) {
			showError(errorMessage(e))
		}
	}
}

/**
 * @param {string} folder - a folder of the Project, '' for all of it
 */
function open(folder) {
	router.replace({ query: { ...route.query, folder: folder || undefined } })
}

/** Invitations and switches made in the dialog show up in the list */
function closeEditing() {
	editing.value = null
	load()
}

/**
 * From a link's settings to a Reviewer's: one dialog at a time
 *
 * @param {number} id - the Reviewer
 */
async function openPerson(id) {
	editing.value = null
	await load()
	person.value = byId.value.get(id) ?? null
}

/**
 * @param {object} reviewer - a Reviewer
 * @return {string} their Personal Link through the first live link
 */
function personalLink(reviewer) {
	const share = links.value[0]
	return reviewer.links.find((each) => each.token === share?.token)?.url ?? reviewer.links[0]?.url
}
</script>

<template>
	<NcAppNavigation :aria-label="t('deliver', 'Folders and links')">
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

			<NcAppNavigationCaption :name="t('deliver', 'Links')" />
			<li v-if="links.length === 0" class="deliver-navigation__hint">
				{{ t('deliver', 'No link with review yet.') }}
			</li>
			<NcAppNavigationItem
				v-for="share in links"
				:key="share.token"
				:name="share.title"
				:allowCollapse="share.reviewerIds.length > 0"
				:open="true"
				:inlineActions="1"
				@click="editing = share">
				<template #icon>
					<NcIconSvgWrapper :svg="iconOf(share)" />
				</template>
				<template #actions>
					<NcActionButton :aria-label="t('deliver', 'Copy link')" @click="copyLink(share.url, t('deliver', 'Link copied'))">
						<template #icon>
							<NcIconSvgWrapper :svg="copyIcon" />
						</template>
						{{ t('deliver', 'Copy link') }}
					</NcActionButton>
				</template>
				<!-- Who was invited through this link or came in by it -->
				<NcAppNavigationItem
					v-for="reviewer in share.reviewerIds.map((id) => byId.get(id)).filter(Boolean)"
					:key="reviewer.id"
					:name="reviewer.name"
					@click="person = reviewer">
					<template #icon>
						<NcIconSvgWrapper :svg="reviewerIcon" />
					</template>
				</NcAppNavigationItem>
			</NcAppNavigationItem>
			<NcAppNavigationItem
				v-if="project && !project.none"
				:name="t('deliver', 'Create Review Link')"
				@click="createLink">
				<template #icon>
					<NcIconSvgWrapper :svg="addIcon" />
				</template>
			</NcAppNavigationItem>

			<template v-if="reviewers.length">
				<NcAppNavigationCaption :name="t('deliver', 'Reviewers')" />
				<NcAppNavigationItem
					v-for="reviewer in reviewers"
					:key="reviewer.id"
					:name="reviewer.name"
					:title="reviewer.email ?? ''"
					:inlineActions="1"
					@click="person = reviewer">
					<template #icon>
						<NcIconSvgWrapper :svg="reviewerIcon" />
					</template>
					<template #actions>
						<NcActionButton v-if="personalLink(reviewer)" :aria-label="t('deliver', 'Copy Personal Link')" @click="copyLink(personalLink(reviewer), t('deliver', 'Link copied'))">
							<template #icon>
								<NcIconSvgWrapper :svg="copyIcon" />
							</template>
							{{ t('deliver', 'Copy Personal Link') }}
						</NcActionButton>
					</template>
				</NcAppNavigationItem>
			</template>
		</template>
		<template #footer>
			<!-- The dialog renders over the page; it only lives here -->
			<ShareLinkDialog
				v-if="editing"
				:share="editing"
				:assets="project?.assets ?? []"
				@update="replace"
				@person="openPerson"
				@deleted="closeEditing"
				@close="closeEditing" />
			<ReviewerDialog
				v-if="person"
				:reviewer="person"
				:links="links"
				:canWrite="project?.canWrite ?? false"
				@changed="load()"
				@remove="dropReviewer(person)"
				@close="person = null" />
		</template>
	</NcAppNavigation>
</template>

<style scoped>
.deliver-navigation__hint {
	padding: 0 calc(3 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
}
</style>
