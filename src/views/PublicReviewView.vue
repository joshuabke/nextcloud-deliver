<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import previousIcon from '@mdi/svg/svg/chevron-left.svg?raw'
import nextIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import { getLanguage, t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
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
import LinkLanding from '../components/LinkLanding.vue'
import ReviewerMailSettings from '../components/ReviewerMailSettings.vue'
import ReviewLayout from '../components/ReviewLayout.vue'
import VersionPicker from '../components/VersionPicker.vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import { claimReviewer, errorMessage, getPublicContext, listPublicAssets } from '../api.js'
import { usePanelOpen } from '../composables/panel.js'
import { useReview } from '../composables/review.js'
import { downloadUrl } from '../lib/links.js'
import { useCommentsStore } from '../store/comments.js'

const props = defineProps({
	/** The Version the link opened on; none opens the grid of its Assets */
	versionId: { type: Number, default: null },
	/** The link's title and description, for that grid */
	link: { type: Object, default: () => ({ title: '', description: null }) },
})

const store = useCommentsStore()
const panelOpen = usePanelOpen()
const isMobile = useIsMobile()
const context = ref(null)
const error = ref(null)
const personalLink = ref(null)
/** The Reviewer with name, address and mail wishes; the Comment answers only carry who they are */
const reviewer = ref(null)
const reviewerName = computed(() => reviewer.value?.name ?? '')
const current = ref(props.versionId)
/** The newest Version of every Asset the link shows, to step through; null while loading */
const newest = ref(null)

/** Who watches, and when: the Reviewer's name once they gave one (story 94) */
const watermarkText = computed(() => [
	store.me?.type === 'reviewer' ? reviewerName.value : t('deliver', 'Guest'),
	new Date().toLocaleDateString(getLanguage()),
].join(' · '))
const version = computed(() => context.value?.versions.find((each) => each.id === current.value) ?? null)
const assetIndex = computed(() => (newest.value ?? []).findIndex((each) => each.assetId === context.value?.asset?.id))
const assetCount = computed(() => newest.value?.length ?? 0)

const { player, panel, mode, clock, anchor, pin, hold, release, jump, posted, drawing, draft, draw, range, markRange, clearRange } = useReview({
	version,
	projectMode: computed(() => context.value?.project.timecodeMode ?? 'smpte'),
	projectFps: computed(() => context.value?.project.fps ?? { num: 25, den: 1 }),
	refresh: reload,
})

watch(current, async (versionId) => {
	if (versionId === null) {
		store.stop()
		context.value = null
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

listPublicAssets().then((entries) => {
	const seen = new Set()
	newest.value = entries.filter((each) => !seen.has(each.assetId) && seen.add(each.assetId))
}).catch(() => {
	newest.value = []
})

onBeforeUnmount(() => store.stop())

/** Reloads what the share shows of this Version, for instance once its Proxy is ready */
async function reload() {
	context.value = await getPublicContext({ versionId: current.value })
	if (context.value.me?.type === 'reviewer') {
		reviewer.value = context.value.me
	}
}

/**
 * @param {number} by - -1 for the previous Asset, 1 for the next
 */
function step(by) {
	const next = newest.value?.[assetIndex.value + by]
	if (next) {
		current.value = next.newestId
	}
}

/**
 * The Reviewer names themselves once. This browser remembers them from now
 * on, and the Personal Link does the same anywhere else (story 54).
 *
 * @param {{name: string, email: string}} identity - what they typed
 */
async function claim({ name, email, mail }) {
	error.value = null
	try {
		const claimed = await claimReviewer(name, email || null, mail)
		personalLink.value = claimed.link
		reviewer.value = claimed
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
			v-else-if="current === null && newest?.length === 0"
			:name="t('deliver', 'Nothing to review here')"
			:description="t('deliver', 'This link shows no file that is enabled for review.')" />
		<LinkLanding
			v-else-if="current === null && newest"
			:link="link"
			:assets="newest"
			@open="current = $event" />
		<NcEmptyContent v-else-if="!context" :name="t('deliver', 'Loading…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<ReviewLayout v-else v-model:panelOpen="panelOpen">
			<template #start>
				<NcButton
					v-if="assetCount > 1"
					variant="tertiary"
					:aria-label="t('deliver', 'All Assets')"
					:title="t('deliver', 'All Assets')"
					@click="current = null">
					<template #icon>
						<NcIconSvgWrapper :svg="backIcon" />
					</template>
				</NcButton>
				<div class="deliver-public__crumbs">
					<h2 class="deliver-layout__title">
						{{ context.asset?.name }}
					</h2>
					<DueDate v-if="isMobile" :modelValue="context.asset?.dueDate ?? null" />
				</div>
				<DueDate v-if="!isMobile" :modelValue="context.asset?.dueDate ?? null" />
			</template>
			<template #center>
				<AssetStepper :index="assetIndex" :count="assetCount" @step="step" />
			</template>
			<template #end>
				<ApprovalControl />
				<VersionPicker :versions="context.versions" :current="current" @select="current = $event" />
				<NcButton
					v-if="context.flags.canDownload && version?.url && !isMobile"
					:href="downloadUrl(version.url)"
					variant="tertiary"
					:aria-label="t('deliver', 'Download the original')"
					:title="t('deliver', 'Download the original')"
					download>
					<template #icon>
						<NcIconSvgWrapper :svg="downloadIcon" />
					</template>
				</NcButton>
			</template>

			<template v-if="assetCount > 1 || (context.flags.canDownload && version?.url)" #menu>
				<NcActionButton
					v-if="assetCount > 1"
					:disabled="assetIndex <= 0"
					closeAfterClick
					@click="step(-1)">
					<template #icon>
						<NcIconSvgWrapper :svg="previousIcon" />
					</template>
					{{ t('deliver', 'Previous Asset') }}
				</NcActionButton>
				<NcActionButton
					v-if="assetCount > 1"
					:disabled="assetIndex < 0 || assetIndex >= assetCount - 1"
					closeAfterClick
					@click="step(1)">
					<template #icon>
						<NcIconSvgWrapper :svg="nextIcon" />
					</template>
					{{ t('deliver', 'Next Asset') }}
				</NcActionButton>
				<NcActionLink v-if="context.flags.canDownload && version?.url" :href="downloadUrl(version.url)" download>
					<template #icon>
						<NcIconSvgWrapper :svg="downloadIcon" />
					</template>
					{{ t('deliver', 'Download the original') }}
				</NcActionLink>
			</template>

			<template #notice>
				<NcNoteCard v-if="error" type="error" class="deliver-layout__notice">
					{{ error }}
				</NcNoteCard>
				<NcNoteCard v-if="personalLink" type="success" class="deliver-layout__notice">
					{{ t('deliver', 'Bookmark your Personal Link. It makes you "{name}" again on any device:', { name: reviewerName }) }}
					<code>{{ personalLink }}</code>
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
				:canComment="store.canComment === true && store.me?.type !== 'unnamed'"
				:watermark="context.flags.watermark ? watermarkText : null"
				@comment="pin($event); panelOpen = true"
				@jump="jump"
				@swipe="step" />

			<template #panel>
				<CommentPanel
					ref="panel"
					:clock="clock"
					:anchor="anchor"
					:draft="draft"
					:drawing="drawing"
					:canDraw="!!version && !version.audioOnly"
					:range="range"
					@draw="draw"
					@range="markRange"
					@clearRange="clearRange"
					@claim="claim"
					@jump="jump"
					@posted="posted"
					@typing="hold"
					@cleared="release">
					<template #tools>
						<ReviewerMailSettings v-if="reviewer" v-model:reviewer="reviewer" />
					</template>
				</CommentPanel>
			</template>
		</ReviewLayout>
	</div>
</template>

<style scoped>

.deliver-public__crumbs {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	min-width: 0;
	padding-inline-start: var(--default-grid-baseline);
}

.deliver-layout__notice code {
	display: block;
	user-select: all;
	overflow-wrap: anywhere;
}
</style>
