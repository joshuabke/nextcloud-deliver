<script setup>
import resolvedIcon from '@mdi/svg/svg/check-circle.svg?raw'
import previousIcon from '@mdi/svg/svg/chevron-left.svg?raw'
import nextIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import clockIcon from '@mdi/svg/svg/clock-outline.svg?raw'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import PersonAvatar from './PersonAvatar.vue'
import { CARD, cardPlace } from '../lib/cardPlace.js'
import { n, t } from '../lib/l10n.js'
import { splitMentions } from '../lib/mentions.js'
import { formatRange } from '../lib/timecode.js'
import { useCommentsStore } from '../store/comments.js'

// The small card a Comment's circle opens, on the Waveform and on the bar
// (#273): who wrote it, where, two lines of it, its Replies counted, and
// Reply, which takes it to the Comment list. Over the circle, clear of it
// and of the playhead, inside the window; it goes with a press anywhere
// else and with Escape.

const props = defineProps({
	/** The Comment, with its Replies */
	comment: { type: Object, required: true },
	/** The Comments of a count circle to step through; null otherwise */
	siblings: { type: Array, default: null },
	/** How time is shown */
	clock: { type: Object, required: true },
	/** The circle in the window, {x: its centre, y: its top edge, line: the playhead to keep clear of or null}, in px */
	at: { type: Object, required: true },
})

/** close: the card goes; show: another Comment of the same place; jump: go to the Comment; reply: answer it in the list */
const emit = defineEmits(['close', 'show', 'jump', 'reply'])

const store = useCommentsStore()
const root = ref(null)
const number = computed(() => store.numbers.get(props.comment.id) ?? null)
const index = computed(() => props.siblings?.findIndex((each) => each.id === props.comment.id) ?? -1)
/** Its text, mentions by name as the list shows them */
const body = computed(() => splitMentions(props.comment.body, props.comment.mentions ?? {}).map((piece) => piece.text).join(''))
const canReply = computed(() => store.canComment === true && store.me?.type !== 'unnamed')
/** Where the focus was, to have it back when the card goes */
const before = document.activeElement

const place = computed(() => {
	const { left, width } = cardPlace(props.at.x, window.innerWidth, props.at.line)
	return {
		left: left + 'px',
		width: width + 'px',
		bottom: window.innerHeight - props.at.y + CARD.gap + 'px',
		maxHeight: props.at.y - CARD.gap - CARD.margin + 'px',
	}
})

/**
 * @param {KeyboardEvent} event - a key
 */
function onKey(event) {
	if (event.key === 'Escape') {
		emit('close')
	}
}

/**
 * A press anywhere but on the card closes it
 *
 * @param {PointerEvent} event - a pointer comes down
 */
function onOutside(event) {
	if (!(event.target instanceof Node) || !root.value.contains(event.target)) {
		emit('close')
	}
}

onMounted(() => {
	root.value.focus({ preventScroll: true })
	window.addEventListener('keydown', onKey)
	document.addEventListener('pointerdown', onOutside, true)
})
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey)
	document.removeEventListener('pointerdown', onOutside, true)
	// The focus goes back where it was, unless it has moved on elsewhere meanwhile
	const focus = document.activeElement
	if ((focus === document.body || root.value.contains(focus)) && before?.isConnected) {
		before.focus({ preventScroll: true })
	}
})
</script>

<template>
	<div
		ref="root"
		class="deliver-comment-card"
		:style="place"
		role="dialog"
		:aria-label="t('deliver', 'Comment #{number}', { number })"
		tabindex="-1"
		@pointerdown.stop
		@wheel.stop>
		<div class="deliver-comment-card__head">
			<PersonAvatar :author="comment.author" :size="20" />
			<span class="deliver-comment-card__author">{{ comment.author.name }}</span>
			<NcIconSvgWrapper
				v-if="comment.resolved"
				class="deliver-comment-card__resolved"
				:svg="resolvedIcon"
				:size="16"
				:name="t('deliver', 'Resolved')" />
			<button
				type="button"
				class="deliver-comment-card__time"
				:title="t('deliver', 'Go to this Frame')"
				@click="emit('jump', comment)">
				<NcIconSvgWrapper :svg="clockIcon" :size="14" inline />
				{{ formatRange(comment, clock) }}
			</button>
		</div>
		<p class="deliver-comment-card__body">
			{{ body }}
		</p>
		<div class="deliver-comment-card__foot">
			<span v-if="comment.replies.length" class="deliver-comment-card__count">{{ n('deliver', '%n reply', '%n replies', comment.replies.length) }}</span>
			<template v-if="siblings">
				<NcButton
					variant="tertiary"
					size="small"
					:disabled="index <= 0"
					:aria-label="t('deliver', 'Previous Comment')"
					@click="emit('show', siblings[index - 1])">
					<template #icon>
						<NcIconSvgWrapper :svg="previousIcon" :size="18" />
					</template>
				</NcButton>
				<span class="deliver-comment-card__count">{{ t('deliver', '{index} of {count}', { index: index + 1, count: siblings.length }) }}</span>
				<NcButton
					variant="tertiary"
					size="small"
					:disabled="index >= siblings.length - 1"
					:aria-label="t('deliver', 'Next Comment')"
					@click="emit('show', siblings[index + 1])">
					<template #icon>
						<NcIconSvgWrapper :svg="nextIcon" :size="18" />
					</template>
				</NcButton>
			</template>
			<span class="deliver-comment-card__spacer" />
			<NcButton
				v-if="canReply"
				variant="secondary"
				size="small"
				@click="emit('reply', comment)">
				{{ t('deliver', 'Reply') }}
			</NcButton>
		</div>
	</div>
</template>

<style scoped>
/* A tooltip's size, fixed to the window: placed by cardPlace, growing upwards from just above the circle */
.deliver-comment-card {
	position: fixed;
	z-index: 10001;
	display: flex;
	flex-direction: column;
	gap: 2px;
	box-sizing: border-box;
	padding: 6px 8px;
	overflow: hidden;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--deliver-card, var(--color-main-background));
	color: var(--color-main-text);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	font-size: 13px;
	line-height: 1.35;
	cursor: auto;
	user-select: text;
	-webkit-user-select: text;
}

.deliver-comment-card:focus {
	outline: none;
}

.deliver-comment-card__head,
.deliver-comment-card__foot {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.deliver-comment-card__author {
	overflow: hidden;
	font-weight: bold;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deliver-comment-card__resolved {
	flex: none;
	color: var(--color-success-text);
}

/* The Comment's place, which goes there as the list's does; the resets keep Nextcloud's button style away, whose margin outweighs a class */
.deliver-comment-card__head > .deliver-comment-card__time {
	display: inline-flex;
	flex: none;
	align-items: center;
	gap: 2px;
	min-height: 0;
	margin: 0 0 0 auto;
	padding: 0 4px;
	border: none;
	border-radius: var(--border-radius);
	background: none;
	color: var(--color-text-maxcontrast);
	font-size: 12px;
	font-weight: normal;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}

.deliver-comment-card__time:hover,
.deliver-comment-card__time:focus-visible {
	background: var(--color-background-hover);
	color: var(--color-main-text);
}

/* Two lines of it; the rest is in the list */
.deliver-comment-card__body {
	display: -webkit-box;
	margin: 0;
	overflow: hidden;
	overflow-wrap: anywhere;
	white-space: pre-line;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
}

.deliver-comment-card__count {
	color: var(--color-text-maxcontrast);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.deliver-comment-card__spacer {
	flex: 1;
}
</style>
