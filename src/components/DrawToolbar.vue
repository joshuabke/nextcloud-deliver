<script setup>
import arrowIcon from '@mdi/svg/svg/arrow-top-right.svg?raw'
import penIcon from '@mdi/svg/svg/draw.svg?raw'
import boxIcon from '@mdi/svg/svg/square-outline.svg?raw'
import undoIcon from '@mdi/svg/svg/undo.svg?raw'
import { t } from '@nextcloud/l10n'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { COLORS } from '../lib/drawing.js'

/** The drawing tools over the picture (story 89) */
const tool = defineModel('tool', { type: String, default: 'pen' })
const color = defineModel('color', { type: String, default: COLORS[0] })
const draft = defineModel('draft', { type: Array, default: () => [] })

const emit = defineEmits(['done'])

const TOOL_ICONS = { pen: penIcon, arrow: arrowIcon, box: boxIcon }
</script>

<template>
	<div class="deliver-drawbar">
		<button
			v-for="(icon, each) in TOOL_ICONS"
			:key="each"
			type="button"
			:aria-pressed="tool === each"
			:title="{ pen: t('deliver', 'Pen'), arrow: t('deliver', 'Arrow'), box: t('deliver', 'Box') }[each]"
			@click="tool = each">
			<NcIconSvgWrapper :svg="icon" :size="20" />
		</button>
		<span class="deliver-drawbar__gap" />
		<button
			v-for="each in COLORS"
			:key="each"
			type="button"
			class="deliver-drawbar__swatch"
			:aria-pressed="color === each"
			:style="{ background: each }"
			:title="each"
			@click="color = each" />
		<span class="deliver-drawbar__gap" />
		<button
			type="button"
			:disabled="!draft.length"
			:title="t('deliver', 'Undo')"
			@click="draft = draft.slice(0, -1)">
			<NcIconSvgWrapper :svg="undoIcon" :size="20" />
		</button>
		<button type="button" class="deliver-drawbar__done" @click="emit('done')">
			{{ t('deliver', 'Done') }}
		</button>
	</div>
</template>

<style scoped>
/* The drawing tools float over the top of the picture */
.deliver-drawbar {
	position: absolute;
	top: 12px;
	left: 50%;
	z-index: 1;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 6px;
	border-radius: var(--border-radius-large);
	background: rgba(20, 20, 22, 0.9);
	transform: translateX(-50%);
}

.deliver-drawbar button {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 32px;
	min-height: 32px;
	margin: 0;
	padding: 4px;
	border: 2px solid transparent;
	border-radius: var(--border-radius);
	background: none;
	color: #fff;
	cursor: pointer;
}

.deliver-drawbar button[aria-pressed='true'] {
	border-color: #fff;
}

.deliver-drawbar button:disabled {
	opacity: 0.4;
	cursor: default;
}

.deliver-drawbar .deliver-drawbar__swatch {
	min-width: 22px;
	min-height: 22px;
	width: 22px;
	height: 22px;
	padding: 0;
	border-radius: 50%;
}

.deliver-drawbar__gap {
	width: 1px;
	height: 20px;
	margin: 0 4px;
	background: rgba(255, 255, 255, 0.25);
}

.deliver-drawbar .deliver-drawbar__done {
	padding: 4px 12px;
	background: var(--color-primary-element);
	font-weight: bold;
}
</style>
