<script setup>
import backIcon from '@mdi/svg/svg/arrow-left.svg?raw'
import swapIcon from '@mdi/svg/svg/swap-horizontal.svg?raw'
import volumeIcon from '@mdi/svg/svg/volume-high.svg?raw'
import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
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
import { frameOnA } from '../lib/compare.js'
import { isStill } from '../lib/media.js'
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
const comments = ref({})
const player = ref(null)
const offset = ref(0)
const mode = ref('side')
const audio = ref('a')
const tab = ref('a')
const LAYOUTS = [
	{ id: 'side', label: t('deliver', 'Side by side') },
	{ id: 'wipe', label: t('deliver', 'Wipe') },
]

const versionA = computed(() => context.value?.versions.find((each) => each.id === props.a) ?? null)
const versionB = computed(() => context.value?.versions.find((each) => each.id === props.b) ?? null)
const clock = computed(() => ({
	fps: versionA.value?.fps ?? { num: 25, den: 1 },
	mode: context.value?.project.timecodeMode ?? 'smpte',
	startFrame: versionA.value?.startFrame ?? 0,
	dropFrame: versionA.value?.dropFrame ?? false,
}))
const tabs = computed(() => [versionA.value, versionB.value].filter(Boolean).map((version, index) => ({
	id: index === 0 ? 'a' : 'b',
	label: t('deliver', 'Comments on V{number}', { number: version.number }),
})))
const shown = computed(() => (comments.value[tab.value === 'a' ? props.a : props.b] ?? []).filter((comment) => comment.parentId === null))

watch(() => [props.a, props.b], async ([a, b]) => {
	error.value = null
	try {
		context.value = await getVersion(a)
		const [listA, listB] = await Promise.all([listComments(a), listComments(b)])
		comments.value = { [a]: listA.comments, [b]: listB.comments }
	} catch (e) {
		error.value = errorMessage(e)
	}
}, { immediate: true })

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
 * @param {object} comment - a Comment of the side on the tab
 */
function jump(comment) {
	const target = tab.value === 'a'
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
			<SegmentedControl v-model="mode" :options="LAYOUTS" :aria-label="t('deliver', 'Layout')" />
			<NcButton
				v-if="!isStill(versionA)"
				variant="tertiary"
				:aria-label="t('deliver', 'Sound of V{number}', { number: (audio === 'a' ? versionA : versionB).number })"
				:title="t('deliver', 'Sound of V{number}; click for the other side', { number: (audio === 'a' ? versionA : versionB).number })"
				@click="audio = audio === 'a' ? 'b' : 'a'">
				<template #icon>
					<NcIconSvgWrapper :svg="volumeIcon" />
				</template>
				{{ t('deliver', 'V{number}', { number: (audio === 'a' ? versionA : versionB).number }) }}
			</NcButton>
		</template>

		<ComparePlayer
			ref="player"
			v-model:offset="offset"
			v-model:mode="mode"
			v-model:audio="audio"
			:a="versionA"
			:b="versionB"
			:clock="clock"
			:commentsA="(comments[a] ?? []).filter((each) => each.parentId === null)"
			:commentsB="(comments[b] ?? []).filter((each) => each.parentId === null)" />

		<template #panel>
			<SegmentedControl
				v-model="tab"
				class="deliver-compare-view__tabs"
				:options="tabs"
				wide />
			<ul v-if="shown.length" class="deliver-compare-view__list">
				<li v-for="comment in shown" :key="comment.id">
					<button
						v-if="!isStill(versionA)"
						type="button"
						class="deliver-compare-view__anchor"
						@click="jump(comment)">
						{{ formatAt(comment.inFrame, tab === 'a' ? clock : { ...clock, fps: versionB.fps, startFrame: versionB.startFrame ?? 0 }) }}
					</button>
					<span class="deliver-compare-view__author">{{ comment.author.name }}</span>
					<p>{{ comment.body }}</p>
				</li>
			</ul>
			<p v-else class="deliver-compare-view__empty">
				{{ t('deliver', 'No Comments yet.') }}
			</p>
		</template>
	</ReviewLayout>
</template>

<style scoped>
.deliver-compare-view__error {
	margin: calc(var(--default-clickable-area) + 4 * var(--default-grid-baseline)) calc(4 * var(--default-grid-baseline));
}

.deliver-compare-view__tabs {
	margin: calc(3 * var(--default-grid-baseline)) calc(3 * var(--default-grid-baseline)) var(--default-grid-baseline);
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
