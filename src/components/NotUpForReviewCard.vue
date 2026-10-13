<script setup>
import moreIcon from '@mdi/svg/svg/dots-horizontal.svg?raw'
import videoIcon from '@mdi/svg/svg/filmstrip.svg?raw'
import audioIcon from '@mdi/svg/svg/waveform.svg?raw'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { useLongPress } from '../composables/longpress.js'

defineProps({
	/** A media file in the Project's folder that is no Asset */
	file: { type: Object, required: true },
	/** Its folder, or the Project's name for the folder itself */
	where: { type: String, required: true },
	/** Whether the Member may add it for review */
	canAdd: { type: Boolean, default: false },
	adding: { type: Boolean, default: false },
})

const emit = defineEmits(['add', 'menu'])

/** The menu opens from a button, by a right click, and by a long press on a phone (story 131) */
const { press, fromButton } = useLongPress((where) => emit('menu', where))
</script>

<template>
	<li class="deliver-not-up deliver-card__menu-host" v-on="press">
		<div class="deliver-card__link">
			<div class="deliver-card__still">
				<NcIconSvgWrapper :svg="file.mimeType.startsWith('audio/') ? audioIcon : videoIcon" :size="40" />
			</div>
			<div class="deliver-card__name" :title="file.name">
				{{ file.name }}
			</div>
			<div class="deliver-card__meta">
				{{ where }}
			</div>
		</div>
		<NcButton
			class="deliver-card__more"
			variant="tertiary"
			:aria-label="t('deliver', 'Actions for {name}', { name: file.name })"
			@click="fromButton">
			<template #icon>
				<NcIconSvgWrapper :svg="moreIcon" />
			</template>
		</NcButton>
		<NcButton
			v-if="canAdd"
			class="deliver-not-up__add"
			variant="secondary"
			:disabled="adding"
			@click="emit('add')">
			{{ t('deliver', 'Add for review') }}
		</NcButton>
	</li>
</template>

<style scoped src="./card.css"></style>

<style scoped>
/* Greyed out until the pointer is on one: it is there in Files, not in review */
.deliver-not-up {
	display: flex;
	flex-direction: column;
	min-width: 0;
	opacity: 0.5;
	transition: opacity 0.15s;
}

.deliver-not-up:hover,
.deliver-not-up:focus-within {
	opacity: 1;
}

.deliver-not-up__add {
	align-self: flex-start;
	margin-inline-start: calc(2 * var(--default-grid-baseline));
}
</style>
