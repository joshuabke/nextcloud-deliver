<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { containedBox, keeps, shapePath } from '../lib/drawing.js'

/** The drawing being made, shape by shape */
const draft = defineModel('draft', { type: Array, default: () => [] })

const props = defineProps({
	/** The picture's own size, to find where it sits in the stage */
	pictureWidth: { type: Number, default: 0 },
	pictureHeight: { type: Number, default: 0 },
	/** Finished drawings to show: lists of shapes */
	shown: { type: Array, default: () => [] },
	/** Whether the pointer draws */
	editing: { type: Boolean, default: false },
	tool: { type: String, default: 'pen' },
	color: { type: String, default: '#ff3b30' },
})

const root = ref(null)
const size = ref({ width: 0, height: 0 })
/** The shape under the pen, until the button is let go */
const current = ref(null)

const box = computed(() => containedBox(props.pictureWidth, props.pictureHeight, size.value.width, size.value.height))
const paths = computed(() => [
	...props.shown.flat(),
	...draft.value,
	...(current.value ? [current.value] : []),
].map((shape) => ({ d: shapePath(shape, box.value.width, box.value.height), color: shape.color })))

let observer = null
onMounted(() => {
	observer = new ResizeObserver(([entry]) => {
		size.value = { width: entry.contentRect.width, height: entry.contentRect.height }
	})
	observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

/**
 * @param {PointerEvent} event - a pointer on the stage
 * @return {number[]} where it is on the picture, from 0 to 1
 */
function pointOf(event) {
	const rect = root.value.getBoundingClientRect()
	const clamp = (value) => Math.min(1, Math.max(0, value))
	return [
		clamp((event.clientX - rect.left - box.value.left) / box.value.width),
		clamp((event.clientY - rect.top - box.value.top) / box.value.height),
	].map((value) => Math.round(value * 10000) / 10000)
}

/**
 * @param {PointerEvent} event - pressing on the picture
 */
function start(event) {
	if (!props.editing) {
		return
	}
	event.preventDefault()
	root.value.setPointerCapture(event.pointerId)
	const point = pointOf(event)
	current.value = { tool: props.tool, color: props.color, points: [point, point] }
	if (props.tool === 'pen') {
		current.value.points = [point]
	}
}

/**
 * @param {PointerEvent} event - moving with the button held
 */
function move(event) {
	if (!current.value) {
		return
	}
	const point = pointOf(event)
	if (current.value.tool === 'pen') {
		if (keeps(current.value.points, point)) {
			current.value.points.push(point)
		}
	} else {
		current.value.points = [current.value.points[0], point]
	}
}

/** The shape is done; a tap without moving leaves nothing behind */
function end() {
	const shape = current.value
	current.value = null
	if (!shape) {
		return
	}
	const [from, to] = [shape.points[0], shape.points[shape.points.length - 1]]
	if (shape.tool === 'pen' ? shape.points.length > 1 : Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.01) {
		draft.value = [...draft.value, shape]
	}
}
</script>

<template>
	<div
		ref="root"
		class="deliver-drawing"
		:class="{ 'deliver-drawing--editing': editing }"
		@pointerdown="start"
		@pointermove="move"
		@pointerup="end"
		@pointercancel="end">
		<svg
			v-if="paths.length"
			:width="size.width"
			:height="size.height"
			aria-hidden="true">
			<g :transform="`translate(${box.left} ${box.top})`">
				<path
					v-for="(path, index) in paths"
					:key="index"
					:d="path.d"
					:stroke="path.color"
					fill="none"
					stroke-width="4"
					stroke-linecap="round"
					stroke-linejoin="round" />
			</g>
		</svg>
	</div>
</template>

<style scoped>
.deliver-drawing {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.deliver-drawing--editing {
	pointer-events: auto;
	cursor: crosshair;
	touch-action: none;
}

.deliver-drawing svg {
	display: block;
	filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
}
</style>
