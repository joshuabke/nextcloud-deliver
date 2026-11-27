<script>
const CUT = 'deliver-name--cut'

/**
 * Lays a two-line name out as the browser wraps it whole, in a probe of the
 * same width and font, and says where its first line ends, if it needs more
 * than two lines.
 *
 * @param {HTMLElement} name - the root of a two-line name, uncut
 * @param {HTMLElement} probe - the probe in it, laid out
 * @return {number|null} where the head's second line starts, null when the name fits
 */
function secondLine(name, probe) {
	if (probe.getBoundingClientRect().height <= name.clientHeight + 0.5) {
		return null
	}
	const text = probe.firstChild
	const range = document.createRange()
	let first = null
	for (let at = 0; at < text.length; at++) {
		range.setStart(text, at)
		range.setEnd(text, at + 1)
		const box = range.getBoundingClientRect()
		if (box.width === 0 && box.height === 0) {
			continue
		}
		first ??= box.top
		if (box.top > first + 1) {
			return at
		}
	}
	return text.length
}

/**
 * Whether two-line names need more than their two lines, and where their
 * first line ends: then the second line is the rest of the head, cut with
 * an ellipsis, and the tail, as a one-line name. All at once, unset, probe,
 * measure, set, so a resize of the window lays the page out once and not
 * once per card.
 *
 * @param {HTMLElement[]} names - roots of two-line names
 */
function measure(names) {
	const probes = names.map((name) => {
		name.classList.remove(CUT)
		const tail = document.createElement('span')
		tail.textContent = name.dataset.tail
		tail.style.whiteSpace = 'nowrap'
		const probe = document.createElement('span')
		probe.style.display = 'block'
		probe.style.visibility = 'hidden'
		probe.append(name.dataset.head, tail)
		return name.appendChild(probe)
	})
	const breaks = names.map((name, index) => secondLine(name, probes[index]))
	names.forEach((name, index) => {
		probes[index].remove()
		const at = breaks[index]
		if (at !== null) {
			name.querySelector('.deliver-name__first').dataset.text = name.dataset.head.slice(0, at)
			name.querySelector('.deliver-name__rest').dataset.text = name.dataset.head.slice(at)
			name.classList.add(CUT)
		}
	})
}

/** CSS cannot tell whether a name reaches past its second line, nor where its first line ends */
const observer = new ResizeObserver((entries) => measure(entries.map((entry) => entry.target)))
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted, onUpdated, useTemplateRef } from 'vue'
import { nameParts } from '../lib/nameParts.js'

const props = defineProps({
	name: { type: String, required: true },
	/** One line, or up to two as on the cards */
	lines: { type: Number, default: 1 },
})

const parts = computed(() => nameParts(props.name))
const root = useTemplateRef('root')

onMounted(() => props.lines === 2 && observer.observe(root.value))
onUpdated(() => props.lines === 2 && measure([root.value]))
onBeforeUnmount(() => observer.unobserve(root.value))
</script>

<template>
	<!-- The name is read out and found once, whole; what shows is drawn from attributes, so it is neither -->
	<span
		ref="root"
		class="deliver-name"
		:class="lines === 2 ? 'deliver-name--two' : 'deliver-name--one'"
		:data-head="parts.head"
		:data-tail="parts.tail">
		<span class="hidden-visually">{{ name }}</span>
		<template v-if="lines === 1">
			<span class="deliver-name__head" aria-hidden="true" :data-text="parts.head" /><span class="deliver-name__tail" aria-hidden="true" :data-text="parts.tail" />
		</template>
		<template v-else>
			<!-- Cut, it stays without a height, so the box keeps the widths the whole name asks for -->
			<span class="deliver-name__whole" aria-hidden="true">
				<span class="deliver-name__head" :data-text="parts.head" /><span class="deliver-name__tail" :data-text="parts.tail" />
			</span>
			<!-- Cut: the first line as it wrapped, then the rest of the head and the tail as on one line -->
			<span class="deliver-name__first" aria-hidden="true" />
			<span class="deliver-name__line" aria-hidden="true">
				<span class="deliver-name__head deliver-name__rest" /><span class="deliver-name__tail" :data-text="parts.tail" />
			</span>
		</template>
	</span>
</template>

<style scoped>
.deliver-name__head::before,
.deliver-name__tail::before,
.deliver-name__first::before {
	content: attr(data-text);
}

/* One line: the head gives way with an ellipsis, the end never */
.deliver-name--one,
.deliver-name__line {
	display: flex;
	min-width: 0;
	overflow: hidden;
}

:is(.deliver-name--one, .deliver-name__line) .deliver-name__head {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: pre;
}

:is(.deliver-name--one, .deliver-name__line) .deliver-name__tail {
	flex: none;
	white-space: pre;
}

/* Two lines, breaking inside a word without spaces where it must */
.deliver-name--two {
	display: block;
	max-height: 2lh;
	overflow: hidden;
	overflow-wrap: anywhere;
}

.deliver-name__whole > .deliver-name__tail {
	white-space: nowrap;
}

.deliver-name--two:not(.deliver-name--cut) :is(.deliver-name__first, .deliver-name__line) {
	display: none;
}

.deliver-name--cut .deliver-name__whole {
	display: block;
	height: 0;
	overflow: hidden;
	visibility: hidden;
}

/* Sized by the box, never sizing it */
.deliver-name__first,
.deliver-name__line {
	contain: inline-size;
}

.deliver-name__first {
	display: block;
	overflow: hidden;
	white-space: nowrap;
}
</style>
