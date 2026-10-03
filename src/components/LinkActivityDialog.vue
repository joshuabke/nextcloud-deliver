<script setup>
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcDateTime from '@nextcloud/vue/components/NcDateTime'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { linkApi } from '../api.js'

// Who opened a link, watched and downloaded what, newest first (story 124)
const props = defineProps({
	/** A Share Link or Project Link as the Project's navigation lists it */
	share: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const activity = ref(null)
linkApi(props.share).activity().then((rows) => {
	activity.value = rows
}).catch(() => {
	activity.value = []
})

const DOINGS = {
	opened: t('deliver', 'opened the link'),
	viewed: t('deliver', 'watched'),
	downloaded: t('deliver', 'downloaded'),
}
</script>

<template>
	<NcDialog :name="t('deliver', 'Activity')" size="normal" @closing="emit('close')">
		<NcEmptyContent v-if="!activity" :name="t('deliver', 'Loading…')">
			<template #icon>
				<NcLoadingIcon />
			</template>
		</NcEmptyContent>
		<NcEmptyContent v-else-if="activity.length === 0" :name="t('deliver', 'Nobody has opened the link yet.')" />
		<table v-else class="deliver-activity">
			<tr v-for="(entry, index) in activity" :key="index">
				<td>
					<span class="deliver-activity__who" :class="{ 'deliver-activity__who--anonymous': !entry.reviewer }">
						{{ entry.reviewer?.name ?? t('deliver', 'Anonymous') }}
					</span>
				</td>
				<td class="deliver-activity__what">
					{{ DOINGS[entry.kind] }}
					<strong v-if="entry.version">
						{{ t('deliver', '{name}, Version {number}', { name: entry.version.name, number: entry.version.number }) }}
					</strong>
				</td>
				<td class="deliver-activity__when">
					<NcDateTime :timestamp="entry.at * 1000" />
				</td>
			</tr>
		</table>
	</NcDialog>
</template>

<style scoped>
.deliver-activity {
	width: 100%;
	margin-bottom: calc(2 * var(--default-grid-baseline));
	border-collapse: collapse;
}

.deliver-activity td {
	padding: calc(1.5 * var(--default-grid-baseline)) var(--default-grid-baseline);
	border-bottom: 1px solid var(--color-border);
	vertical-align: middle;
}

.deliver-activity__who {
	display: inline-block;
	max-width: 200px;
	vertical-align: middle;
	padding: 2px 10px;
	border-radius: var(--border-radius-element);
	background: var(--color-primary-element-light);
	color: var(--color-primary-element-light-text);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.deliver-activity__who--anonymous {
	background: var(--color-background-dark);
	color: var(--color-text-maxcontrast);
}

.deliver-activity__what {
	width: 100%;
	white-space: normal;
	overflow-wrap: anywhere;
}

.deliver-activity__when {
	color: var(--color-text-maxcontrast);
	white-space: nowrap;
	text-align: end;
}
</style>
