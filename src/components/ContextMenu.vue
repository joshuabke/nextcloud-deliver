<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'

const props = defineProps({
	/** Where the right click was, in viewport pixels */
	x: { type: Number, required: true },
	y: { type: Number, required: true },
	/** [{ label, icon, action or href, danger }] */
	items: { type: Array, required: true },
})

const emit = defineEmits(['close'])

const menu = ref(null)
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
		emit('close')
	}
}

onMounted(async () => {
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
	<Teleport to="body">
		<ul
			ref="menu"
			class="deliver-context-menu"
			role="menu"
			:style="{ left: `${left}px`, top: `${top}px` }"
			@keydown="onKey"
			@contextmenu.prevent>
			<li v-for="item in items" :key="item.label" role="none">
				<!-- Links for every entry: Nextcloud styles every button of its own, which shifts the icons -->
				<a
					:href="item.href ?? '#'"
					role="menuitem"
					class="deliver-context-menu__item"
					:class="{ 'deliver-context-menu__item--danger': item.danger }"
					@click="item.href ? emit('close') : ($event.preventDefault(), choose(item))">
					<NcIconSvgWrapper :svg="item.icon" :size="20" />
					{{ item.label }}
				</a>
			</li>
		</ul>
	</Teleport>
</template>

<style scoped>
.deliver-context-menu {
	position: fixed;
	z-index: 10000;
	min-width: 220px;
	padding: 4px;
	border-radius: var(--border-radius-large, 12px);
	background: var(--color-main-background);
	box-shadow: 0 1px 10px var(--color-box-shadow, rgba(0, 0, 0, 0.3));
}

.deliver-context-menu__item {
	box-sizing: border-box;
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-height: var(--default-clickable-area, 34px);
	padding: 0 12px 0 8px;
	border-radius: var(--border-radius, 8px);
	color: var(--color-main-text);
	cursor: pointer;
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
	color: var(--color-error-text, var(--color-error));
}
</style>
