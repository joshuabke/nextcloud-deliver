<script setup>
import reviewerIcon from '@mdi/svg/svg/account-outline.svg?raw'
import copyIcon from '@mdi/svg/svg/content-copy.svg?raw'
import imageLinkIcon from '@mdi/svg/svg/file-image-outline.svg?raw'
import audioLinkIcon from '@mdi/svg/svg/file-music-outline.svg?raw'
import videoLinkIcon from '@mdi/svg/svg/file-video-outline.svg?raw'
import projectLinkIcon from '@mdi/svg/svg/folder-account-outline.svg?raw'
import folderIcon from '@mdi/svg/svg/folder-outline.svg?raw'
import allIcon from '@mdi/svg/svg/folder-play-outline.svg?raw'
import projectWideIcon from '@mdi/svg/svg/link-box-variant-outline.svg?raw'
import pausedIcon from '@mdi/svg/svg/link-variant-off.svg?raw'
import linkIcon from '@mdi/svg/svg/link-variant.svg?raw'
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
import { createProjectLink, errorMessage, listProjectShares, removeReviewer } from '../api.js'
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
/** My Share Links in this Project that have review on */
const links = ref([])
/** The Project's Reviewers, each once, with their Personal Link through every review link */
const reviewers = ref([])
/** The Share Link whose settings are open */
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
	const found = await listProjectShares(id).catch(() => ({ projectLinks: [], links: [], reviewers: [] }))
	if (props.id === id) {
		// Project Links first, paused ones too (ADR 0010); then Share Links from Files, the Project folder's first
		links.value = [
			...found.projectLinks.map((link, index) => ({ ...link, title: link.label || (index === 0 ? t('deliver', 'Project Link') : t('deliver', 'Project Link {number}', { number: index + 1 })) })),
			...found.links
				.filter((share) => share.review)
				.map((share) => ({ ...share, title: share.isProject ? t('deliver', 'Project folder') : (share.label || share.name) }))
				.sort((a, b) => b.isProject - a.isProject || a.title.localeCompare(b.title)),
		]
		reviewers.value = found.reviewers
		person.value = person.value && (byId.value.get(person.value.id) ?? null)
	}
}

/**
 * @param {object} share - a Share Link or Project Link
 * @return {string} for a Project Link whether it is paused or shows all or picked Assets; for a Share Link a folder with a person for the Project folder, else what kind of file it shows
 */
function iconOf(share) {
	if (share.kind === 'project') {
		return !share.review ? pausedIcon : share.assetIds === null ? projectWideIcon : pickedIcon
	}
	if (share.isProject) {
		return projectLinkIcon
	}
	const kind = share.mimeType?.split('/')[0]
	return { video: videoLinkIcon, audio: audioLinkIcon, image: imageLinkIcon }[kind] ?? linkIcon
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
 * Auto Intake from the link's settings: switched on, it takes in what is there,
 * so the counts and the Asset list are read again.
 *
 * @param {boolean} on - Auto Intake on or off
 */
async function setAutoIntake(on) {
	try {
		await store.save(props.id, { autoIntake: on })
		await Promise.all([load(), store.fetch(props.id)])
		editing.value = links.value.find((share) => share.token === editing.value?.token) ?? editing.value
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
 * @return {string} their Personal Link through the Project folder's link, or through the first review link
 */
function personalLink(reviewer) {
	const share = links.value[0]
	return reviewer.links.find((each) => each.token === share?.token)?.url ?? reviewer.links[0]?.url
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

			<NcAppNavigationCaption :name="t('deliver', 'Links')" />
			<li v-if="links.length === 0" class="deliver-navigation__hint">
				{{ t('deliver', 'No link with review yet.') }}
			</li>
			<NcAppNavigationItem
				v-for="share in links"
				:key="share.token"
				:name="share.title"
				:title="share.isProject ? t('deliver', 'Link to the whole Project folder') : share.name"
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
				:canWrite="editing.kind === 'project' || (project?.canWrite ?? false)"
				:autoIntake="project?.autoIntake ?? false"
				:assets="project?.assets ?? []"
				@autoIntake="setAutoIntake"
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
