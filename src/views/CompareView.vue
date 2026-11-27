<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import swapIcon from '@mdi/svg/svg/swap-horizontal.svg?raw'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ComparePlayer from '../components/ComparePlayer.vue'
import ReviewLayout from '../components/ReviewLayout.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import VersionPicker from '../components/VersionPicker.vue'
import { errorMessage, getVersion, listComments } from '../api.js'
import { usePanelOpen } from '../composables/panel.js'
import { DERIVED_RECHECK } from '../composables/review.js'
import { frameOnA } from '../lib/compare.js'
import { t } from '../lib/l10n.js'
import { derivedPending, isStill } from '../lib/media.js'
import { formatAt } from '../lib/timecode.js'

const props = defineProps({
	/** The leading Version */
	a: { type: Number, required: true },
	/** The Version compared with it */
	b: { type: Number, required: true },
})

const router = useRouter()
const panelOpen = usePanelOpen()
const context = ref(null)
const error = ref(null)
/** Each side's Comments, without their Replies */
const comments = ref({})
const player = ref(null)
const offset = ref(0)
const mode = ref('side')
const audio = ref('a')
/** The side whose Comments the list shows: the one someone last switched the sound to */
const listed = ref('a')
const LAYOUTS = [
	{ id: 'side', label: t('deliver', 'Side by side') },
	{ id: 'wipe', label: t('deliver', 'Wipe') },
]

const versionA = computed(() => context.value?.versions.find((each) => each.id === props.a) ?? null)
const versionB = computed(() => context.value?.versions.find((each) => each.id === props.b) ?? null)
const audioOnly = computed(() => versionA.value?.audioOnly === true)
const clock = computed(() => ({
	fps: versionA.value?.fps ?? { num: 25, den: 1 },
	displayFps: audioOnly.value ? context.value?.project.fps : undefined,
	mode: audioOnly.value ? 'ms' : context.value?.project.timecodeMode ?? 'smpte',
	startFrame: versionA.value?.startFrame ?? 0,
	dropFrame: versionA.value?.dropFrame ?? false,
}))
/** Side B's Comments read in its own Frames */
const clockB = computed(() => ({ ...clock.value, fps: versionB.value?.fps, startFrame: versionB.value?.startFrame ?? 0 }))
const commentsA = computed(() => comments.value[props.a] ?? [])
const commentsB = computed(() => comments.value[props.b] ?? [])
const shown = computed(() => listed.value === 'a' ? commentsA.value : commentsB.value)

watch(() => [props.a, props.b], async ([a, b]) => {
	error.value = null
	try {
		context.value = await getVersion(a)
		const [listA, listB] = await Promise.all([listComments(a), listComments(b)])
		const topLevel = (list) => list.comments.filter((comment) => comment.parentId === null)
		comments.value = { [a]: topLevel(listA), [b]: topLevel(listB) }
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

let recheck = null
// While either side's derived media is being made, the pair asks again, so a Waveform that becomes ready shows
watch(() => [versionA.value?.derived, versionB.value?.derived], () => {
	clearTimeout(recheck)
	if (derivedPending(versionA.value) || derivedPending(versionB.value)) {
		const a = props.a
		recheck = setTimeout(() => getVersion(a).then((fresh) => {
			if (props.a === a) {
				context.value = fresh
			}
		}).catch(() => {}), DERIVED_RECHECK)
	}
})
onBeforeUnmount(() => clearTimeout(recheck))

/**
 * @param {number} a - the leading Version
 * @param {number} b - the one compared with it
 */
function open(a, b) {
	if (a !== b) {
		router.replace(`/compare/${a}/${b}`)
	}
}

/** The sides change places; the offset, counted in B's Frames, turns into the other side's */
function swap() {
	const fpsA = versionA.value.fps
	const fpsB = versionB.value.fps
	offset.value = -Math.round(offset.value * (fpsA.num * fpsB.den) / (fpsA.den * fpsB.num))
	open(props.b, props.a)
}

/**
 * @param {object} comment - a Comment of the side listed
 */
function jump(comment) {
	const target = listed.value === 'a'
		? comment.inFrame
		: frameOnA(comment.inFrame, versionA.value.fps, versionB.value.fps, offset.value)
	player.value?.seekTo(target)
}
</script>

<template>
	<NcNoteCard v-if="error && !context" type="error" class="deliver-compare-view__error">
		{{ error }}
	</NcNoteCard>
	<NcEmptyContent v-else-if="!context || !versionA || !versionB" :name="t('deliver', 'Loading Version…')">
		<template #icon>
			<NcLoadingIcon />
		</template>
	</NcEmptyContent>
	<ReviewLayout v-else v-model:panelOpen="panelOpen">
		<template #start>
			<NcButton
				variant="tertiary"
				:to="`/versions/${b}`"
				:aria-label="t('deliver', 'Back to the Review')"
				:title="t('deliver', 'Back to the Review')">
				<template #icon>
					<NcIconSvgWrapper :svg="backIcon" />
				</template>
			</NcButton>
			<h2 class="deliver-layout__title">
				{{ context.asset.name }}
			</h2>
		</template>
		<template #center>
			<VersionPicker
				:versions="context.versions"
				:current="a"
				label=""
				@select="open($event, b)" />
			<NcButton
				variant="tertiary"
				:aria-label="t('deliver', 'Swap sides')"
				:title="t('deliver', 'Swap sides')"
				@click="swap">
				<template #icon>
					<NcIconSvgWrapper :svg="swapIcon" />
				</template>
			</NcButton>
			<VersionPicker
				:versions="context.versions"
				:current="b"
				label=""
				@select="open(a, $event)" />
		</template>
		<template #end>
			<!-- Two pieces of audio have no pictures to lay out -->
			<SegmentedControl
				v-if="!audioOnly || !versionB.audioOnly"
				v-model="mode"
				:options="LAYOUTS"
				:aria-label="t('deliver', 'Layout')" />
		</template>

		<!-- The Comments shown follow the side someone switches the sound to, not a pass of Alternate A/B -->
		<ComparePlayer
			ref="player"
			v-model:offset="offset"
			v-model:audio="audio"
			:mode="mode"
			:a="versionA"
			:b="versionB"
			:clock="clock"
			:commentsA="commentsA"
			:commentsB="commentsB"
			@listen="listed = $event" />

		<template #panel>
			<!-- Named, since while Alternate A/B plays the switch shows the other side; on a phone held upright the list waits under the grabber, as the Review view's does -->
			<h3 class="deliver-compare-view__heading deliver-comments__head">
				{{ t('deliver', 'Comments on V{number}', { number: (listed === 'a' ? versionA : versionB).number }) }}
			</h3>
			<ul v-if="shown.length" class="deliver-compare-view__list deliver-comments__list">
				<li v-for="comment in shown" :key="comment.id">
					<button
						v-if="!isStill(versionA)"
						type="button"
						class="deliver-compare-view__anchor"
						@click="jump(comment)">
						{{ formatAt(comment.inFrame, listed === 'a' ? clock : clockB) }}
					</button>
					<span class="deliver-compare-view__author">{{ comment.author.name }}</span>
					<p>{{ comment.body }}</p>
				</li>
			</ul>
			<p v-else class="deliver-compare-view__empty deliver-comments__empty">
				{{ t('deliver', 'No Comments yet.') }}
			</p>
		</template>
	</ReviewLayout>
</template>

<style scoped>
.deliver-compare-view__error {
	margin: calc(var(--default-clickable-area) + 4 * var(--default-grid-baseline)) calc(4 * var(--default-grid-baseline));
}

.deliver-compare-view__heading {
	display: flex;
	align-items: center;
	min-height: var(--default-clickable-area);
	margin: var(--default-grid-baseline) 0 0;
	padding: 0 calc(3 * var(--default-grid-baseline));
	font-size: var(--default-font-size);
	font-weight: bold;
}

.deliver-compare-view__list {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	padding: calc(3 * var(--default-grid-baseline));
	overflow-y: auto;
}

.deliver-compare-view__list li {
	padding: calc(2 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline));
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);
	background: var(--deliver-card);
}

.deliver-compare-view__list p {
	margin: 4px 0 0;
	white-space: pre-wrap;
}

.deliver-compare-view__anchor {
	min-height: 0;
	margin: 0 8px 0 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--deliver-timecode);
	font-family: monospace;
	font-weight: normal;
	cursor: pointer;
}

.deliver-compare-view__author {
	font-weight: bold;
}

.deliver-compare-view__empty {
	padding: calc(4 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
	text-align: center;
}
</style>
