<script setup>
import changesIcon from '@mdi/svg/svg/alert-circle-outline.svg?raw'
import approvedIcon from '@mdi/svg/svg/check-decagram.svg?raw'
import commentIcon from '@mdi/svg/svg/comment-outline.svg?raw'
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import assetIcon from '@mdi/svg/svg/filmstrip.svg?raw'
import audioIcon from '@mdi/svg/svg/waveform.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import MediaStill from './MediaStill.vue'
import { useLongPress } from '../composables/longpress.js'
import { isStill } from '../lib/media.js'
import { runtime } from '../lib/timecode.js'

const props = defineProps({
	/** An Asset with its Version Stack, newest first */
	asset: { type: Object, required: true },
	/** The Assets its filename could join (story 14) */
	candidates: { type: Array, default: () => [] },
	/** Whether the Stack may be managed here */
	canWrite: { type: Boolean, default: false },
	/** Whether its checkbox is ticked (story 141) */
	selected: { type: Boolean, default: false },
	/** Whether any card is ticked, so every checkbox shows */
	selecting: { type: Boolean, default: false },
	/** Whether it may not join the ticked ones: Missing Assets go only with Missing ones (story 141) */
	locked: { type: Boolean, default: false },
})

const emit = defineEmits(['stack', 'menu', 'versions', 'select'])

/** The menu opens from a button on every screen, by a right click, and by a long press on a phone (stories 109 and 129) */
const isMobile = useIsMobile()
const { press, fromButton } = useLongPress((where) => emit('menu', where))

const newest = computed(() => props.asset.versions[0])
/** A Version stacked by its name waits here until a Member keeps or undoes it (story 13) */
const autoStacked = computed(() => props.canWrite && !isMobile.value && props.asset.versions.some((version) => version.autoStacked))
/** Comments by others on any Version of the Stack that I have not had on screen */
const unseen = computed(() => props.asset.versions.reduce((sum, version) => sum + version.unseen, 0))
const audio = computed(() => newest.value.mimeType?.startsWith('audio/'))
/** Requested changes outweigh approvals: the newest Version is not through while anyone wants changes (story 88) */
const decision = computed(() => {
	const { approved = 0, changes = 0 } = newest.value.approvals
	if (changes > 0) {
		return { kind: 'changes', icon: changesIcon, text: n('deliver', '%n requests changes', '%n request changes', changes) }
	}
	return approved > 0 ? { kind: 'approved', icon: approvedIcon, text: n('deliver', 'Approved by %n', 'Approved by %n', approved) } : null
})
/** Bottom right of the still, unless a status takes the place (story 130) */
const length = computed(() => isStill(newest.value) ? null : runtime(newest.value.durationFrames, newest.value.fps))
const status = computed(() => {
	if (newest.value.state === 'missing') {
		return { text: t('deliver', 'Missing'), kind: 'warning' }
	}
	if (newest.value.processingFailed) {
		return { text: t('deliver', 'Processing failed'), kind: 'warning' }
	}
	if (newest.value.processing) {
		return {
			text: newest.value.processing.progress === null
				? t('deliver', 'Processing')
				: t('deliver', 'Processing, {percent} %', { percent: newest.value.processing.progress }),
			kind: 'info',
		}
	}
	return null
})
</script>

<template>
	<li
		class="deliver-card deliver-card__menu-host"
		:class="{ 'deliver-card--selecting': canWrite && (selecting || isMobile), 'deliver-card--selected': selected }"
		v-on="press">
		<RouterLink class="deliver-card__link" :to="`/versions/${newest.id}`">
			<div class="deliver-card__still">
				<NcIconSvgWrapper :svg="audio ? audioIcon : assetIcon" :size="40" />
				<MediaStill
					v-if="!audio && newest.state === 'ready'"
					:fileId="newest.fileId"
					:playUrl="newest.mimeType?.startsWith('video/') ? newest.playUrl : null"
					fit="contain" />
				<span class="deliver-card__version">{{ t('deliver', 'V{number}', { number: newest.number }) }}</span>
				<span
					v-if="unseen"
					class="deliver-card__comments deliver-card__comments--unseen"
					:title="n('deliver', '%n Unseen Comment', '%n Unseen Comments', unseen)">
					<NcIconSvgWrapper :svg="commentIcon" :size="14" inline />
					{{ unseen }}
				</span>
				<span v-else-if="newest.comments" class="deliver-card__comments">
					<NcIconSvgWrapper :svg="commentIcon" :size="14" inline />
					{{ newest.comments }}
				</span>
				<span
					v-if="decision"
					class="deliver-card__decision"
					:class="`deliver-card__decision--${decision.kind}`"
					:title="decision.text">
					<NcIconSvgWrapper :svg="decision.icon" :size="14" inline />
				</span>
				<span v-if="status" class="deliver-card__status" :class="`deliver-card__status--${status.kind}`">{{ status.text }}</span>
				<span v-else-if="length" class="deliver-card__status">{{ length }}</span>
			</div>
			<div class="deliver-card__name" :title="newest.name">
				{{ asset.name }}
			</div>
			<div class="deliver-card__meta">
				<NcDateTime :timestamp="newest.createdAt * 1000" />
			</div>
			<DueDate v-if="asset.dueDate" class="deliver-card__due" :modelValue="asset.dueDate" />
		</RouterLink>
		<!-- Outside the link, so ticking it does not open the Asset -->
		<input
			v-if="canWrite"
			class="deliver-card__select"
			type="checkbox"
			:checked="selected"
			:disabled="locked"
			:title="!locked ? undefined : t('deliver', 'Missing Assets are selected only together with other Missing ones')"
			:aria-label="t('deliver', 'Select {name}', { name: asset.name })"
			@click="emit('select', $event.shiftKey)">
		<NcButton
			class="deliver-card__more"
			variant="tertiary"
			:aria-label="t('deliver', 'Actions for {name}', { name: asset.name })"
			@click="fromButton">
			<template #icon>
				<NcIconSvgWrapper :svg="moreIcon" />
			</template>
		</NcButton>
		<div v-if="autoStacked" class="deliver-card__suggestion">
			<span>{{ t('deliver', 'Stacked automatically, going by its name') }}</span>
			<NcButton variant="secondary" @click="emit('versions', asset)">
				{{ t('deliver', 'Manage Versions') }}
			</NcButton>
		</div>
		<div v-if="candidates.length" class="deliver-card__suggestion">
			<span>{{ t('deliver', 'Stack as a Version of:') }}</span>
			<NcButton
				v-for="candidate in candidates"
				:key="candidate.id"
				variant="secondary"
				:title="candidate.versions[0].name"
				@click="emit('stack', asset, candidate)">
				{{ candidate.name }}
			</NcButton>
		</div>
	</li>
</template>

<style scoped src="./card.css"></style>

<style scoped>
.deliver-card {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
	min-width: 0;
}

.deliver-card__version,
.deliver-card__comments,
.deliver-card__status {
	position: absolute;
	display: flex;
	align-items: center;
	gap: 3px;
	padding: 1px 6px;
	border-radius: var(--border-radius);
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	font-size: 12px;
	font-weight: bold;
}

.deliver-card__decision {
	position: absolute;
	top: 6px;
	inset-inline-end: 6px;
	display: flex;
	padding: 3px;
	border-radius: 50%;
	color: #fff;
}

.deliver-card__decision--approved {
	background: #2e7d32;
}

.deliver-card__decision--changes {
	background: #c77800;
}

.deliver-card__comments--unseen {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.deliver-card__version {
	top: 6px;
	inset-inline-start: 6px;
}

.deliver-card__comments {
	bottom: 6px;
	inset-inline-start: 6px;
}

.deliver-card__status {
	bottom: 6px;
	inset-inline-end: 6px;
}

.deliver-card__status--warning {
	background: var(--color-warning);
	color: var(--color-warning-text);
}

.deliver-card__meta {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-card__suggestion {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--default-grid-baseline);
	padding: 0 calc(2 * var(--default-grid-baseline));
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

/* Top left over the still; shown on hover, on every card once one is ticked, and always on a phone, which has no hover */
.deliver-card__select {
	position: absolute;
	top: 14px;
	inset-inline-start: 14px;
	width: 20px;
	height: 20px;
	min-height: 0;
	margin: 0;
	cursor: pointer;
	accent-color: var(--color-primary-element);
	opacity: 0;
}

.deliver-card__select:disabled {
	cursor: not-allowed;
}

.deliver-card:hover .deliver-card__select,
.deliver-card__select:focus-visible,
.deliver-card--selecting .deliver-card__select {
	opacity: 1;
}

/* The Version moves aside for the checkbox while it shows */
.deliver-card:has(.deliver-card__select):hover .deliver-card__version,
.deliver-card--selecting .deliver-card__version {
	inset-inline-start: 38px;
}

.deliver-card--selected {
	outline: 2px solid var(--color-primary-element);
	border-radius: var(--border-radius-large);
}
</style>
