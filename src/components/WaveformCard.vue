<script setup>
import previousIcon from '@mdi/svg/svg/chevron-left.svg?raw'
import nextIcon from '@mdi/svg/svg/chevron-right.svg?raw'
import closeIcon from '@mdi/svg/svg/close.svg?raw'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CommentItem from './CommentItem.vue'
import { t } from '../lib/l10n.js'
import { useCommentsStore } from '../store/comments.js'

// A Comment opened from its circle on the scrolling Waveform (story 181): the
// Comment as the list shows it, with its Replies and the field to answer, and
// "Go to". At the wave, or on a phone a sheet from below.

const props = defineProps({
	comment: { type: Object, required: true },
	/** How time is shown */
	clock: { type: Object, required: true },
	/** Where on the stage it stands, its middle; null for the sheet */
	left: { type: Number, default: null },
	/** The Comments of a count circle that no zoom parts, to step through; null otherwise */
	siblings: { type: Array, default: null },
	/** Elements whose clicks are not outside: the stage handles its own */
	inside: { type: Array, default: () => [] },
})

/** close: the card goes; jump: go to the Comment; show: another Comment of the same place */
const emit = defineEmits(['close', 'jump', 'show'])

const store = useCommentsStore()
const root = ref(null)
const number = computed(() => store.numbers.get(props.comment.id) ?? null)
const index = computed(() => props.siblings?.findIndex((each) => each.id === props.comment.id) ?? -1)
/** Where the focus was, to have it back when the card goes */
const before = document.activeElement

/**
 * @return {boolean} whether something in the card is under way: a Reply half written or a menu open
 */
function busy() {
	return [...root.value.querySelectorAll('textarea')].some((field) => field.value.trim() !== '')
		|| root.value.querySelector('[aria-expanded="true"]') !== null
}

/**
 * Escape closes the card wherever the focus is, but not while a Reply is half written or its menu is open
 *
 * @param {KeyboardEvent} event - a key
 */
function onKey(event) {
	if (event.key === 'Escape' && !busy()) {
		emit('close')
	}
}

/**
 * A click outside closes it: on the bar, the page, anywhere but the card, its
 * menus, the stage, which handles its own, and the Comment list, whose
 * selection the card follows. A Reply half written stays in the store.
 *
 * @param {PointerEvent} event - a pointer comes down
 */
function onOutside(event) {
	const target = event.target
	if (!(target instanceof Element) || root.value.contains(target) || target.closest('.v-popper__popper, .deliver-comments__list')
		|| props.inside.some((element) => element?.contains(target))) {
		return
	}
	emit('close')
}

onMounted(() => {
	root.value.focus()
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
		class="deliver-wave-card"
		:class="{ 'deliver-wave-card--sheet': left === null }"
		:style="left === null ? null : { left: left + 'px' }"
		role="dialog"
		:aria-label="t('deliver', 'Comment #{number}', { number })"
		tabindex="-1"
		@pointerdown.stop
		@dblclick.stop
		@wheel.stop>
		<ul class="deliver-wave-card__thread">
			<CommentItem
				:comment="comment"
				:clock="clock"
				:number="number"
				replyOpen
				@jump="emit('jump', $event)" />
		</ul>
		<div class="deliver-wave-card__actions">
			<template v-if="siblings">
				<NcButton
					variant="tertiary"
					:disabled="index <= 0"
					:aria-label="t('deliver', 'Previous Comment')"
					@click="emit('show', siblings[index - 1])">
					<template #icon>
						<NcIconSvgWrapper :svg="previousIcon" />
					</template>
				</NcButton>
				<span class="deliver-wave-card__count">{{ t('deliver', '{index} of {count}', { index: index + 1, count: siblings.length }) }}</span>
				<NcButton
					variant="tertiary"
					:disabled="index >= siblings.length - 1"
					:aria-label="t('deliver', 'Next Comment')"
					@click="emit('show', siblings[index + 1])">
					<template #icon>
						<NcIconSvgWrapper :svg="nextIcon" />
					</template>
				</NcButton>
			</template>
			<span class="deliver-wave-card__spacer" />
			<NcButton variant="secondary" @click="emit('jump', comment)">
				{{ t('deliver', 'Go to') }}
			</NcButton>
			<NcButton variant="tertiary" :aria-label="t('deliver', 'Close')" @click="emit('close')">
				<template #icon>
					<NcIconSvgWrapper :svg="closeIcon" />
				</template>
			</NcButton>
		</div>
	</div>
</template>

<style scoped>
/* At the wave, over the circles, as the marker's card over the bar but grown up */
.deliver-wave-card {
	position: absolute;
	bottom: calc(40px + 4px);
	z-index: 3;
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	width: 360px;
	max-height: calc(100% - 52px);
	padding: calc(2 * var(--default-grid-baseline));
	overflow-y: auto;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-large);
	background: var(--deliver-card, var(--color-main-background));
	color: var(--color-main-text);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	transform: translateX(-50%);
	cursor: auto;
	user-select: text;
	-webkit-user-select: text;
}

/* A phone: a sheet from below, over the whole width */
.deliver-wave-card--sheet {
	position: fixed;
	inset: auto 0 0;
	z-index: 10001;
	width: auto;
	max-height: 70vh;
	padding-bottom: calc(2 * var(--default-grid-baseline) + env(safe-area-inset-bottom));
	border-radius: var(--border-radius-large) var(--border-radius-large) 0 0;
	transform: none;
}

.deliver-wave-card:focus {
	outline: none;
}

/* Always in reach, also where a long thread scrolls in a low sheet */
.deliver-wave-card__actions {
	position: sticky;
	bottom: calc(-2 * var(--default-grid-baseline));
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	padding-block: var(--default-grid-baseline);
	background: inherit;
}

.deliver-wave-card__spacer {
	flex: 1;
}

.deliver-wave-card__count {
	color: var(--color-text-maxcontrast);
	font-size: 13px;
	font-variant-numeric: tabular-nums;
}
</style>
