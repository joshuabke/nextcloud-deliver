<script setup>
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import { getLanguage, t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ApprovalControl from '../components/ApprovalControl.vue'
import AssetStepper from '../components/AssetStepper.vue'
import CommentPanel from '../components/CommentPanel.vue'
import DueDate from '../components/DueDate.vue'
import ImageViewer from '../components/ImageViewer.vue'
import ReviewLayout from '../components/ReviewLayout.vue'
import VersionPicker from '../components/VersionPicker.vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import { claimReviewer, errorMessage, getPublicContext, listPublicAssets } from '../api.js'
import { usePanelOpen } from '../composables/panel.js'
import { useReview } from '../composables/review.js'
import { useCommentsStore } from '../store/comments.js'

const props = defineProps({
	/** The Version the Share Link opened on */
	versionId: { type: Number, default: null },
})

const store = useCommentsStore()
const panelOpen = usePanelOpen()
const context = ref(null)
const error = ref(null)
const personalLink = ref(null)
/** The name the Reviewer gave; the Comment answers only carry who they are, not their name */
const reviewerName = ref('')
const current = ref(props.versionId)
/** The newest Version of every Asset the share shows, to step through */
const newest = ref([])

/** Who watches, and when: the Reviewer's name once they gave one (story 94) */
const watermarkText = computed(() => [
	store.me?.type === 'reviewer' ? (reviewerName.value || context.value?.me?.name || '') : t('deliver', 'Guest'),
	new Date().toLocaleDateString(getLanguage()),
].join(' · '))
const version = computed(() => context.value?.versions.find((each) => each.id === current.value) ?? null)
const assetIndex = computed(() => newest.value.findIndex((each) => each.assetId === context.value?.asset?.id))

const { player, panel, mode, clock, anchor, pin, hold, release, jump, posted, drawing, draft, draw } = useReview({
	version,
	projectMode: computed(() => context.value?.project.timecodeMode ?? 'smpte'),
	refresh: reload,
})

watch(current, async (versionId) => {
	if (versionId === null) {
		return
	}
	error.value = null
	try {
		await reload()
		await store.open(versionId)
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

if (props.versionId !== null) {
	listPublicAssets().then((entries) => {
		const seen = new Set()
		newest.value = entries.filter((each) => !seen.has(each.assetId) && seen.add(each.assetId))
	}).catch(() => {})
}

onBeforeUnmount(() => store.stop())

/** Reloads what the share shows of this Version, for instance once its Proxy is ready */
async function reload() {
	context.value = await getPublicContext({ versionId: current.value })
}

/**
 * @param {number} by - -1 for the previous Asset, 1 for the next
 */
function step(by) {
	const next = newest.value[assetIndex.value + by]
	if (next) {
		current.value = next.versionId
	}
}

/**
 * The Reviewer names themselves once. This browser remembers them from now
 * on, and the Personal Link does the same anywhere else (story 54).
 *
 * @param {{name: string, email: string}} identity - what they typed
 */
async function claim({ name, email }) {
	error.value = null
	try {
		const reviewer = await claimReviewer(name, email || null)
		personalLink.value = reviewer.link
		reviewerName.value = reviewer.name
		await store.reload()
	} catch (e) {
		error.value = errorMessage(e)
	}
}
</script>

<template>
	<div class="deliver-public">
		<NcNoteCard v-if="error && !context" type="error">
			{{ error }}
		</NcNoteCard>
		<NcEmptyContent
			v-else-if="versionId === null"
			:name="t('deliver', 'Nothing to review here')"
			:description="t('deliver', 'This link shows no file that is enabled for review.')" />
		<NcEmptyContent v-else-if="!context" :name="t('deliver', 'Loading…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<ReviewLayout v-else v-model:panelOpen="panelOpen">
			<template #start>
				<h2 class="deliver-public__title">
					{{ context.asset?.name }}
				</h2>
				<DueDate :modelValue="context.asset?.dueDate ?? null" />
			</template>
			<template #center>
				<AssetStepper :index="assetIndex" :count="newest.length" @step="step" />
			</template>
			<template #end>
				<ApprovalControl />
				<VersionPicker :versions="context.versions" :current="current" @select="current = $event" />
				<NcButton
					v-if="context.flags.canDownload && version?.url"
					:href="version.url"
					variant="tertiary"
					:aria-label="t('deliver', 'Download the original')"
					:title="t('deliver', 'Download the original')"
					download>
					<template #icon>
						<NcIconSvgWrapper :svg="downloadIcon" />
					</template>
				</NcButton>
			</template>

			<template #notice>
				<NcNoteCard v-if="error" type="error" class="deliver-public__notice">
					{{ error }}
				</NcNoteCard>
				<NcNoteCard v-if="personalLink" type="success" class="deliver-public__notice">
					{{ t('deliver', 'Bookmark your Personal Link. It makes you "{name}" again on any device:', { name: reviewerName }) }}
					<code>{{ personalLink }}</code>
				</NcNoteCard>
			</template>

			<ImageViewer
				v-if="version && clock.still"
				ref="player"
				v-model:draft="draft"
				v-model:drawing="drawing"
				:version="version"
				:comments="store.threads"
				:canComment="store.canComment === true && store.me?.type !== 'unnamed'"
				:watermark="context.flags.watermark ? watermarkText : null"
				@comment="pin($event); panelOpen = true"
				@jump="jump" />
			<VideoPlayer
				v-else-if="version"
				ref="player"
				v-model:mode="mode"
				v-model:draft="draft"
				v-model:drawing="drawing"
				:version="version"
				:comments="store.threads"
				:clock="clock"
				:canComment="store.canComment === true && store.me?.type !== 'unnamed'"
				:watermark="context.flags.watermark ? watermarkText : null"
				@comment="pin($event); panelOpen = true"
				@jump="jump" />

			<template #panel>
				<CommentPanel
					ref="panel"
					:clock="clock"
					:anchor="anchor"
					:draft="draft"
					:drawing="drawing"
					:canDraw="!!version && !version.audioOnly"
					@draw="draw"
					@claim="claim"
					@jump="jump"
					@posted="posted"
					@typing="hold"
					@cleared="release" />
			</template>
		</ReviewLayout>
	</div>
</template>

<style scoped>
.deliver-public {
	/* The public page renders on the guest layout, so the view brings its own surface,
	   and leaves room for the guest layout's own footer */
	box-sizing: border-box;
	width: calc(100vw - 4 * var(--default-grid-baseline, 4px));
	max-width: 1800px;
	height: calc(100vh - 140px);
	margin: calc(2 * var(--default-grid-baseline, 4px)) auto;
	border-radius: var(--border-radius-large, 12px);
	background: var(--color-main-background);
	overflow: hidden;
}

.deliver-public__title {
	margin: 0;
	font-size: 16px;
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-public__notice {
	margin: calc(2 * var(--default-grid-baseline, 4px)) calc(3 * var(--default-grid-baseline, 4px)) 0;
}

.deliver-public__notice code {
	display: block;
	user-select: all;
	overflow-wrap: anywhere;
}

@media (max-width: 1024px) {
	.deliver-public {
		height: auto;
	}
}
</style>
