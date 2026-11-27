<script>
const CUT = 'deliver-name--cut'

/**
 * Whether a name of two lines needs more: then its end floats to the end of
 * the second line. All at once, unset, measured, set, so a resize of the
 * window lays the page out once and not once per card.
 *
 * @param {Element[]} names - two-line names
 */
function measure(names) {
	names.forEach((name) => name.classList.remove(CUT))
	names.filter((name) => name.scrollHeight > name.clientHeight).forEach((name) => name.classList.add(CUT))
}

/** CSS can place the end at the end of the second line, but cannot tell whether the name reaches past it */
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
	<span ref="root" class="deliver-name" :class="lines === 2 ? 'deliver-name--two' : 'deliver-name--one'">
		<span class="hidden-visually">{{ name }}</span>
		<span
			v-if="lines === 2"
			class="deliver-name__tail deliver-name__tail--end"
			aria-hidden="true"
			:data-text="parts.tail" />
		<span class="deliver-name__head" aria-hidden="true" :data-text="parts.head" /><span class="deliver-name__tail" aria-hidden="true" :data-text="parts.tail" />
	</span>
</template>

<style scoped>
.deliver-name__head::before,
.deliver-name__tail::after {
	content: attr(data-text);
}

/* One line: the head gives way with an ellipsis, the end never */
.deliver-name--one {
	display: flex;
	min-width: 0;
	overflow: hidden;
}

.deliver-name--one .deliver-name__head {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: pre;
}

.deliver-name--one .deliver-name__tail {
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

.deliver-name--two .deliver-name__tail {
	white-space: nowrap;
}

.deliver-name--two .deliver-name__tail--end {
	display: none;
}

/* Cut: an empty float a line high pushes the end below it, to the end of the second line, and the head flows around it */
.deliver-name--cut::before {
	content: '';
	float: inline-end;
	height: 1lh;
}

.deliver-name--cut .deliver-name__tail--end {
	display: inline;
	float: inline-end;
	clear: inline-end;
}

.deliver-name--cut .deliver-name__tail--end::before {
	content: '…';
}

.deliver-name--cut .deliver-name__tail:not(.deliver-name__tail--end) {
	display: none;
}
</style>
