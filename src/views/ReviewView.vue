<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import dueIcon from '@mdi/svg/svg/calendar-clock.svg?raw'
import previousIcon from '@mdi/svg/svg/chevron-left.svg?raw'
import nextIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import compareIcon from '@mdi/svg/svg/compare.svg?raw'
import shareIcon from '@mdi/svg/svg/share-variant-outline.svg?raw'
import uploadIcon from '@mdi/svg/svg/tray-arrow-up.svg?raw'
import { t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ApprovalControl from '../components/ApprovalControl.vue'
import AssetStepper from '../components/AssetStepper.vue'
import CommentPanel from '../components/CommentPanel.vue'
import DueDate from '../components/DueDate.vue'
import DueDateDialog from '../components/DueDateDialog.vue'
import ExportMenu from '../components/ExportMenu.vue'
import ImageViewer from '../components/ImageViewer.vue'
import ReviewLayout from '../components/ReviewLayout.vue'
import ShareLinks from '../components/ShareLinks.vue'
import VersionPicker from '../components/VersionPicker.vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import { errorMessage, getVersion, giveWaveform, listMembers, updateAsset, uploadNextVersion } from '../api.js'
import { useLiveUpdates } from '../composables/live.js'
import { usePanelOpen } from '../composables/panel.js'
import { useReview } from '../composables/review.js'
import { groupByFolder, uploadFolder } from '../lib/folders.js'
import { acceptFor } from '../lib/media.js'
import { fpsValue } from '../lib/timecode.js'
import { decodeWaveform } from '../lib/waveform.js'
import { useCommentsStore } from '../store/comments.js'
import { useProjectsStore } from '../store/projects.js'

const props = defineProps({
	id: { type: Number, required: true },
})

const router = useRouter()
const store = useCommentsStore()
const projects = useProjectsStore()
const panelOpen = usePanelOpen()
/** A phone gets the essentials in the bar and the rest in its menu; comparing, exporting and restacking stay on larger screens */
const isMobile = useIsMobile()
useLiveUpdates(store)
const context = ref(null)
const error = ref(null)
const uploading = ref(false)
const fileInput = ref(null)
/** The phone's date picker for a first Due Date; once set, the date in the bar changes it */
const pickingDue = ref(false)
/** The Project Links of this Version's Asset, in a dialog */
const sharing = ref(false)
/** Who can be mentioned in this Project */
const members = ref([])

const version = computed(() => context.value?.versions.find((each) => each.id === props.id) ?? null)
const projectName = computed(() => context.value?.project.none ? t('deliver', 'No Project') : context.value?.project.name)

/** The Project's Assets in the order the Project view shows them, to step through */
const assets = computed(() => {
	const project = projects.details[context.value?.project.id]
	return project ? groupByFolder(project.assets).flatMap((group) => group.assets) : []
})
const assetIndex = computed(() => assets.value.findIndex((asset) => asset.id === context.value?.asset.id))
/** The Version to compare with: the one before this, or the newest when this is the first */
const compareWith = computed(() => {
	const stack = context.value?.versions ?? []
	const index = stack.findIndex((each) => each.id === props.id)
	return (stack[index + 1] ?? stack[0])?.id
})
const folderUrl = computed(() => uploadFolder(context.value?.versions ?? []))

const { player, panel, mode, clock, anchor, pin, hold, release, jump, posted, drawing, draft, draw, range, markRange, clearRange } = useReview({
	version,
	projectMode: computed(() => context.value?.project.timecodeMode ?? 'smpte'),
	projectFps: computed(() => context.value?.project.fps ?? { num: 25, den: 1 }),
	refresh: reload,
})

watch(() => props.id, async (id) => {
	error.value = null
	try {
		context.value = await getVersion(id)
		await store.open(id)
		listMembers(id).then((list) => {
			members.value = list
		}).catch(() => {})
		if (!projects.details[context.value.project.id]) {
			projects.fetch(context.value.project.id).catch(() => {})
		}
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

onBeforeUnmount(() => store.stop())

/** Reloads the Version Stack after stacking, renumbering, a drop upload or new derived media */
async function reload() {
	context.value = await getVersion(props.id)
}

/** Without ffmpeg the first Member to open audio decodes its Waveform, for everyone after */
const decoded = new Set()
watch(version, async (each) => {
	if (each?.audioOnly !== true || each.derived?.waveform?.state !== 'none' || !each.url || decoded.has(each.id)) {
		return
	}
	decoded.add(each.id)
	try {
		const { peaks, seconds } = await decodeWaveform(each.url)
		await giveWaveform(each.id, peaks, Math.max(1, Math.round(seconds * fpsValue(each.fps))))
		await reload()
	} catch {
		// The player plays without a Waveform; the next visit tries again
	}
}, { immediate: true })

/**
 * @param {string|null} dueDate - the new Due Date, or null
 */
async function setDue(dueDate) {
	try {
		context.value.asset.dueDate = (await updateAsset(context.value.asset.id, { dueDate })).dueDate
		projects.fetch(context.value.project.id).catch(() => {})
	} catch (e) {
		error.value = errorMessage(e)
	}
}

/**
 * @param {number} by - -1 for the previous Asset, 1 for the next
 */
function step(by) {
	const asset = assets.value[assetIndex.value + by]
	if (asset) {
		router.push(`/versions/${asset.versions[0].id}`)
	}
}

/**
 * Uploads the picked file as the next Version and opens it
 *
 * @param {Event} event - the file input's change event
 */
async function upload(event) {
	const file = event.target.files?.[0]
	event.target.value = ''
	if (!file) {
		return
	}
	uploading.value = true
	error.value = null
	try {
		const versionId = await uploadNextVersion(folderUrl.value, file, context.value.asset.id)
		projects.fetch(context.value.project.id).catch(() => {})
		router.push(`/versions/${versionId}`)
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		uploading.value = false
	}
}
</script>

<template>
	<NcNoteCard v-if="error && !context" type="error" class="deliver-review__error">
		{{ error }}
	</NcNoteCard>
	<NcEmptyContent v-else-if="!context" :name="t('deliver', 'Loading Version…')">
		<template #icon>
			<NcLoadingIcon />
		</template>
	</NcEmptyContent>
	<ReviewLayout
		v-else
		v-model:panelOpen="panelOpen"
		class="deliver-review">
		<template #start>
			<NcButton
				variant="tertiary"
				:to="`/projects/${context.project.id}`"
				:aria-label="t('deliver', 'Back to {project}', { project: projectName })"
				:title="t('deliver', 'Back to {project}', { project: projectName })">
				<template #icon>
					<NcIconSvgWrapper :svg="backIcon" />
				</template>
			</NcButton>
			<div class="deliver-review__crumbs">
				<div class="deliver-review__over">
					<RouterLink class="deliver-review__project" :to="`/projects/${context.project.id}`">
						{{ projectName }}
					</RouterLink>
					<DueDate
						v-if="isMobile && context.asset.dueDate"
						class="deliver-review__due"
						:modelValue="context.asset.dueDate"
						:editable="context.canWrite"
						@update:modelValue="setDue" />
				</div>
				<h2 class="deliver-layout__title deliver-review__title" tabindex="-1">
					{{ context.asset.name }}
				</h2>
			</div>
			<DueDate
				v-if="!isMobile"
				:modelValue="context.asset.dueDate"
				:editable="context.canWrite"
				@update:modelValue="setDue" />
		</template>
		<template #center>
			<AssetStepper :index="assetIndex" :count="assets.length" @step="step" />
		</template>
		<template #end>
			<ApprovalControl />
			<NcButton
				v-if="context.versions.length > 1 && !isMobile"
				variant="tertiary"
				:to="`/compare/${compareWith}/${id}`"
				:aria-label="t('deliver', 'Compare with another Version')"
				:title="t('deliver', 'Compare with another Version')">
				<template #icon>
					<NcIconSvgWrapper :svg="compareIcon" />
				</template>
			</NcButton>
			<VersionPicker :versions="context.versions" :current="id" @select="$router.push(`/versions/${$event}`)" />
			<template v-if="context.canWrite">
				<NcButton
					v-if="folderUrl && !isMobile"
					:disabled="uploading"
					:title="t('deliver', 'Upload a new cut and stack it on top')"
					@click="fileInput.click()">
					<template #icon>
						<NcLoadingIcon v-if="uploading" />
						<NcIconSvgWrapper v-else :svg="uploadIcon" />
					</template>
					{{ t('deliver', 'New Version') }}
				</NcButton>
				<input
					ref="fileInput"
					type="file"
					:accept="acceptFor(version?.mimeType)"
					hidden
					@change="upload">
				<NcButton v-if="version?.url && !isMobile" @click="sharing = true">
					<template #icon>
						<NcIconSvgWrapper :svg="shareIcon" />
					</template>
					{{ t('deliver', 'Share') }}
				</NcButton>
			</template>
		</template>

		<template #menu>
			<NcActionButton :disabled="assetIndex <= 0" closeAfterClick @click="step(-1)">
				<template #icon>
					<NcIconSvgWrapper :svg="previousIcon" />
				</template>
				{{ t('deliver', 'Previous Asset') }}
			</NcActionButton>
			<NcActionButton :disabled="assetIndex < 0 || assetIndex >= assets.length - 1" closeAfterClick @click="step(1)">
				<template #icon>
					<NcIconSvgWrapper :svg="nextIcon" />
				</template>
				{{ t('deliver', 'Next Asset') }}
			</NcActionButton>
			<template v-if="context.canWrite">
				<NcActionButton
					v-if="folderUrl"
					:disabled="uploading"
					closeAfterClick
					@click="fileInput.click()">
					<template #icon>
						<NcIconSvgWrapper :svg="uploadIcon" />
					</template>
					{{ t('deliver', 'New Version') }}
				</NcActionButton>
				<NcActionButton v-if="!context.asset.dueDate" closeAfterClick @click="pickingDue = true">
					<template #icon>
						<NcIconSvgWrapper :svg="dueIcon" />
					</template>
					{{ t('deliver', 'Set a Due Date') }}
				</NcActionButton>
				<NcActionButton v-if="version?.url" closeAfterClick @click="sharing = true">
					<template #icon>
						<NcIconSvgWrapper :svg="shareIcon" />
					</template>
					{{ t('deliver', 'Share') }}
				</NcActionButton>
			</template>
		</template>

		<template #notice>
			<NcNoteCard v-if="error" type="error" class="deliver-layout__notice">
				{{ error }}
			</NcNoteCard>
			<NcNoteCard v-if="version?.state === 'missing'" type="warning" class="deliver-layout__notice">
				{{ t('deliver', 'The file of this Version is gone from the Project folder. Its Comments are kept.') }}
			</NcNoteCard>
		</template>

		<component
			:is="clock.still ? ImageViewer : VideoPlayer"
			v-if="version"
			ref="player"
			v-model:mode="mode"
			v-model:draft="draft"
			v-model:drawing="drawing"
			:version="version"
			:comments="store.threads"
			:clock="clock"
			:canComment="store.canComment === true"
			@comment="pin($event); panelOpen = true"
			@jump="jump"
			@swipe="step" />

		<template #panel>
			<CommentPanel
				ref="panel"
				:clock="clock"
				:anchor="anchor"
				:members="members"
				:draft="draft"
				:drawing="drawing"
				:canDraw="!!version && !version.audioOnly"
				:range="range"
				@draw="draw"
				@range="markRange"
				@clearRange="clearRange"
				@jump="jump"
				@posted="posted"
				@typing="hold"
				@cleared="release">
				<template #tools>
					<ExportMenu
						v-if="context.canWrite && !isMobile"
						:versionId="id"
						:audioOnly="version?.audioOnly ?? false"
						:wavExport="version?.wavExport ?? false"
						:still="clock.still" />
				</template>
			</CommentPanel>
		</template>
	</ReviewLayout>
	<DueDateDialog
		v-if="pickingDue && context"
		:modelValue="context.asset.dueDate"
		@update:modelValue="setDue"
		@close="pickingDue = false" />
	<NcDialog
		v-if="sharing && version"
		:name="t('deliver', 'Review Links on {name}', { name: context.asset.name })"
		size="normal"
		@closing="sharing = false">
		<ShareLinks :projectId="context.project.id" :assetId="context.asset.id" />
	</NcDialog>
</template>

<style scoped>
.deliver-review__crumbs {
	display: flex;
	flex-direction: column;
	min-width: 0;
	line-height: 1.25;
}

/* The Project this Asset belongs to, one click back */
.deliver-review__over {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	min-width: 0;
}

.deliver-review__due {
	flex: none;
	font-size: 12px;
}

.deliver-review__project {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--color-text-maxcontrast);
	font-size: 12px;
}

.deliver-review__project:hover {
	text-decoration: underline;
}

.deliver-review__title {
	outline: none;
}

.deliver-review__error {
	margin: calc(var(--default-clickable-area) + 4 * var(--default-grid-baseline)) calc(4 * var(--default-grid-baseline));
}

</style>
