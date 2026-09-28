<script setup>
import changesIcon from '@mdi/svg/svg/alert-circle-outline.svg?raw'
import approvedIcon from '@mdi/svg/svg/check-decagram.svg?raw'
import commentIcon from '@mdi/svg/svg/comment-outline.svg?raw'
import assetIcon from '@mdi/svg/svg/filmstrip.svg?raw'
import audioIcon from '@mdi/svg/svg/waveform.svg?raw'
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import DueDate from './DueDate.vue'
import { previewUrl } from '../lib/preview.js'

const props = defineProps({
	/** An Asset with its Version Stack, newest first */
	asset: { type: Object, required: true },
	/** The Assets its filename could join (story 14) */
	candidates: { type: Array, default: () => [] },
})

const emit = defineEmits(['stack'])

const newest = computed(() => props.asset.versions[0])
/** Comments by others on any Version of the Stack that I have not had on screen */
const unseen = computed(() => props.asset.versions.reduce((sum, version) => sum + version.unseen, 0))
const audio = computed(() => newest.value.mimeType?.startsWith('audio/'))
/** Set when the server could not render a still; the icon stands in */
const noPreview = ref(false)
/** Requested changes outweigh approvals: the newest Version is not through while anyone wants changes (story 88) */
const decision = computed(() => {
	const { approved = 0, changes = 0 } = newest.value.approvals ?? {}
	if (changes > 0) {
		return { kind: 'changes', icon: changesIcon, text: n('deliver', '%n requests changes', '%n request changes', changes) }
	}
	return approved > 0 ? { kind: 'approved', icon: approvedIcon, text: n('deliver', 'Approved by %n', 'Approved by %n', approved) } : null
})
const status = computed(() => {
	if (newest.value.state === 'missing') {
		return { text: t('deliver', 'Missing'), kind: 'warning' }
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
	<li class="deliver-card">
		<RouterLink class="deliver-card__link" :to="`/versions/${newest.id}`">
			<div class="deliver-card__still">
				<img
					v-if="!noPreview && !audio && newest.state === 'ready'"
					:src="previewUrl(newest.fileId, 400)"
					alt=""
					@error="noPreview = true">
				<NcIconSvgWrapper v-else :svg="audio ? audioIcon : assetIcon" :size="40" />
				<span
					class="deliver-card__version"
					:class="{ 'deliver-card__version--unseen': !newest.seen }"
					:title="newest.seen ? null : t('deliver', 'Unseen Version')">{{ t('deliver', 'V{number}', { number: newest.number }) }}</span>
				<span
					v-if="unseen"
					class="deliver-card__comments deliver-card__comments--unseen"
					:title="n('deliver', '%n Unseen Comment', '%n Unseen Comments', unseen)">
					<NcIconSvgWrapper :svg="commentIcon" :size="14" />
					{{ unseen }}
				</span>
				<span v-else-if="newest.comments" class="deliver-card__comments">
					<NcIconSvgWrapper :svg="commentIcon" :size="14" />
					{{ newest.comments }}
				</span>
				<span
					v-if="decision"
					class="deliver-card__decision"
					:class="`deliver-card__decision--${decision.kind}`"
					:title="decision.text">
					<NcIconSvgWrapper :svg="decision.icon" :size="14" />
				</span>
				<span v-if="status" class="deliver-card__status" :class="`deliver-card__status--${status.kind}`">{{ status.text }}</span>
			</div>
			<div class="deliver-card__name" :title="asset.name">
				{{ asset.name }}
			</div>
			<div class="deliver-card__meta">
				{{ newest.name }}
			</div>
			<DueDate v-if="asset.dueDate" class="deliver-card__due" :modelValue="asset.dueDate" />
		</RouterLink>
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

<style scoped>
.deliver-card {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline, 4px));
	min-width: 0;
}

.deliver-card__link {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: calc(2 * var(--default-grid-baseline, 4px));
	border-radius: var(--border-radius-large, 12px);
	color: var(--color-main-text);
}

.deliver-card__link:hover,
.deliver-card__link:focus-visible {
	background: var(--color-background-hover);
}

.deliver-card__still {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	aspect-ratio: 16 / 9;
	margin-bottom: var(--default-grid-baseline, 4px);
	border-radius: var(--border-radius, 8px);
	background: #111;
	color: #bbb;
	overflow: hidden;
}

.deliver-card__still img {
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.deliver-card__version,
.deliver-card__comments,
.deliver-card__status {
	position: absolute;
	display: flex;
	align-items: center;
	gap: 3px;
	padding: 1px 6px;
	border-radius: var(--border-radius, 4px);
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

.deliver-card__version--unseen,
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
	inset-inline-end: 6px;
}

.deliver-card__status {
	bottom: 6px;
	inset-inline-start: 6px;
}

.deliver-card__status--warning {
	background: var(--color-warning);
	color: var(--color-warning-text, #000);
}

.deliver-card__due {
	align-self: flex-start;
	margin-top: 4px;
}

.deliver-card__name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.deliver-card__meta {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-card__suggestion {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--default-grid-baseline, 4px);
	padding: 0 calc(2 * var(--default-grid-baseline, 4px));
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}
</style>
