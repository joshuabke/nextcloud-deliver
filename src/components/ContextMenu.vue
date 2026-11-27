<script setup>
import commentIcon from '@mdi/svg/svg/comment-outline.svg?raw'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import BottomSheet from './BottomSheet.vue'
import MediaStill from './MediaStill.vue'
import { groupItems } from '../lib/menu.js'

const props = defineProps({
	/** Where the right click was, in viewport pixels */
	x: { type: Number, required: true },
	y: { type: Number, required: true },
	/** [{ label, icon, action or href (download: a filename to save it under), danger, disabled, group: where a phone begins a new group }] */
	items: { type: Array, required: true },
	/** A heading above the entries, saying what they act on */
	title: { type: String, default: null },
	/** What a phone shows above the entries: { name, icon, line, timestamp, fileId and scrubUrl for a still, comments, runtime } */
	head: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const menu = ref(null)
/** On a phone the menu is a sheet from below, with what it acts on above its entries (#301); decided once, as it opens */
const sheet = useIsMobile().value
const groups = computed(() => groupItems(props.items))
const left = ref(props.x)
const top = ref(props.y)

/**
 * @param {object} item - the chosen entry
 */
function choose(item) {
	emit('close')
	item.action?.()
}

/**
 * Arrow keys walk the entries, Escape and Tab leave
 *
 * @param {KeyboardEvent} event - the key
 */
function onKey(event) {
	const entries = [...menu.value.querySelectorAll('[role=menuitem]')]
	const index = entries.indexOf(document.activeElement)
	if (sheet && (event.key === 'Escape' || event.key === 'Tab')) {
		// The sheet closes on Escape and keeps Tab inside
		return
	}
	if (event.key === 'Escape' || event.key === 'Tab') {
		event.preventDefault()
		emit('close')
	} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault()
		const step = event.key === 'ArrowDown' ? 1 : -1
		entries[(index + step + entries.length) % entries.length]?.focus()
	}
}

/**
 * @param {PointerEvent} event - a click anywhere
 */
function onOutside(event) {
	if (!menu.value?.contains(event.target)) {
		swallowClick()
		emit('close')
	}
}

/**
 * The press outside only closes the menu: the click that follows it reaches
 * neither the card under it nor the button that opened the menu (#298). No
 * click follows a scroll, so the next press ends the wait.
 */
function swallowClick() {
	/** @param {MouseEvent} event - the click after the press */
	function swallow(event) {
		event.preventDefault()
		event.stopPropagation()
		done()
	}
	/** Stops waiting for the click */
	function done() {
		document.removeEventListener('click', swallow, true)
		document.removeEventListener('pointerdown', done, true)
	}
	document.addEventListener('click', swallow, true)
	// Not called for the press under way: listeners added while an event is dispatched wait for the next one
	document.addEventListener('pointerdown', done, true)
}

onMounted(async () => {
	if (sheet) {
		return
	}
	await nextTick()
	// Keep the menu inside the window
	const { width, height } = menu.value.getBoundingClientRect()
	left.value = Math.min(props.x, window.innerWidth - width - 8)
	top.value = Math.min(props.y, window.innerHeight - height - 8)
	menu.value.querySelector('[role=menuitem]')?.focus()
	document.addEventListener('pointerdown', onOutside, true)
	window.addEventListener('blur', close)
	window.addEventListener('resize', close)
})
onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', onOutside, true)
	window.removeEventListener('blur', close)
	window.removeEventListener('resize', close)
})

/** The window lost focus or changed size */
function close() {
	emit('close')
}
</script>

<template>
	<BottomSheet v-if="sheet" :label="head?.name ?? title ?? ''" @close="emit('close')">
		<div v-if="head" class="deliver-menu-sheet__head">
			<div class="deliver-menu-sheet__still">
				<NcIconSvgWrapper :svg="head.icon" :size="40" />
				<MediaStill
					v-if="head.fileId"
					:fileId="head.fileId"
					:scrubUrl="head.scrubUrl"
					fit="contain" />
				<span v-if="head.comments" class="deliver-menu-sheet__badge deliver-menu-sheet__badge--start">
					<NcIconSvgWrapper :svg="commentIcon" :size="14" inline />
					{{ head.comments }}
				</span>
				<span v-if="head.runtime" class="deliver-menu-sheet__badge deliver-menu-sheet__badge--end">{{ head.runtime }}</span>
			</div>
			<div class="deliver-menu-sheet__name">
				{{ head.name }}
			</div>
			<div v-if="head.line || head.timestamp" class="deliver-menu-sheet__line">
				{{ head.line }}<template v-if="head.line && head.timestamp">
					·
				</template><NcDateTime v-if="head.timestamp" :timestamp="head.timestamp * 1000" />
			</div>
		</div>
		<div v-if="title" class="deliver-menu-sheet__title">
			{{ title }}
		</div>
		<div
			class="deliver-menu-sheet"
			role="menu"
			:aria-label="title ?? head?.name"
			@keydown="onKey">
			<div
				v-for="(group, index) in groups"
				:key="index"
				role="group"
				class="deliver-menu-sheet__group">
				<a
					v-for="item in group"
					:key="item.label"
					:href="item.href ?? '#'"
					:download="item.download"
					role="menuitem"
					class="deliver-context-menu__item deliver-menu-sheet__item"
					:class="{ 'deliver-context-menu__item--danger': item.danger, 'deliver-context-menu__item--disabled': item.disabled }"
					:aria-disabled="item.disabled || undefined"
					@click="item.href ? emit('close') : ($event.preventDefault(), item.disabled || choose(item))">
					<NcIconSvgWrapper :svg="item.icon" :size="20" />
					{{ item.label }}
				</a>
			</div>
		</div>
	</BottomSheet>
	<Teleport v-else to="body">
		<ul
			ref="menu"
			class="deliver-context-menu"
			role="menu"
			:style="{ left: `${left}px`, top: `${top}px` }"
			:aria-label="title"
			@keydown="onKey"
			@contextmenu.prevent>
			<li v-if="title" role="presentation" class="deliver-context-menu__title">
				{{ title }}
			</li>
			<li v-for="item in items" :key="item.label" role="none">
				<!-- Links for every entry: Nextcloud styles every button of its own, which shifts the icons -->
				<a
					:href="item.href ?? '#'"
					:download="item.download"
					role="menuitem"
					class="deliver-context-menu__item"
					:class="{ 'deliver-context-menu__item--danger': item.danger, 'deliver-context-menu__item--disabled': item.disabled }"
					:aria-disabled="item.disabled || undefined"
					@click="item.href ? emit('close') : ($event.preventDefault(), item.disabled || choose(item))">
					<NcIconSvgWrapper :svg="item.icon" :size="20" />
					{{ item.label }}
				</a>
			</li>
		</ul>
	</Teleport>
</template>

<style scoped>
/* On a phone: what the entries act on, the still with its Comments and length, the whole name and a line below */
.deliver-menu-sheet__head {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: var(--default-grid-baseline);
	padding-bottom: calc(4 * var(--default-grid-baseline));
	text-align: center;
}

.deliver-menu-sheet__still {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 160px;
	aspect-ratio: 16 / 9;
	overflow: hidden;
	margin-bottom: calc(2 * var(--default-grid-baseline));
	border-radius: var(--border-radius-large);
	/* Dark behind a picture, as on the cards */
	background: #111;
	color: #bbb;
}

.deliver-menu-sheet__badge {
	position: absolute;
	bottom: 6px;
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

.deliver-menu-sheet__badge--start {
	inset-inline-start: 6px;
}

.deliver-menu-sheet__badge--end {
	inset-inline-end: 6px;
}

/* The whole name, on as many lines as it takes */
.deliver-menu-sheet__name {
	max-width: 100%;
	font-size: 16px;
	font-weight: bold;
	overflow-wrap: anywhere;
}

.deliver-menu-sheet__line,
.deliver-menu-sheet__title {
	color: var(--color-text-maxcontrast);
}

.deliver-menu-sheet__title {
	padding: 0 0 calc(2 * var(--default-grid-baseline));
	font-weight: bold;
	text-align: center;
}

.deliver-menu-sheet {
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline));
}

/* Each group a card of its own, its entries split by a line */
.deliver-menu-sheet__group {
	overflow: hidden;
	border-radius: var(--border-radius-large);
	background: var(--color-background-hover);
}

.deliver-menu-sheet__item {
	gap: calc(4 * var(--default-grid-baseline));
	min-height: 48px;
	padding: 0 calc(4 * var(--default-grid-baseline));
	border-radius: 0;
}

.deliver-menu-sheet__item + .deliver-menu-sheet__item {
	border-top: 1px solid var(--color-border);
}

.deliver-menu-sheet__item:hover,
.deliver-menu-sheet__item:focus-visible {
	background: var(--color-background-darker);
}

.deliver-context-menu {
	position: fixed;
	z-index: 10000;
	min-width: 220px;
	padding: 4px;
	border-radius: var(--border-radius-large);
	background: var(--color-main-background);
	box-shadow: 0 1px 10px var(--color-box-shadow);
}

.deliver-context-menu__title {
	padding: 6px 12px 6px 8px;
	color: var(--color-text-maxcontrast);
	font-weight: bold;
}

.deliver-context-menu__item {
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-height: var(--default-clickable-area);
	padding: 0 12px 0 8px;
	border-radius: var(--border-radius);
	color: var(--color-main-text);
	cursor: pointer;
}

/* Says why something cannot be done here, rather than leaving it out */
.deliver-context-menu__item--disabled {
	color: var(--color-text-maxcontrast);
	cursor: default;
}

.deliver-context-menu__item :deep(.icon-vue) {
	width: 20px;
	flex: none;
	min-width: 20px;
	height: 20px;
	opacity: 1;
}

.deliver-context-menu__item:hover,
.deliver-context-menu__item:focus-visible {
	background: var(--color-background-hover);
	outline: none;
}

.deliver-context-menu__item--danger {
	color: var(--color-error-text);
}
</style>
