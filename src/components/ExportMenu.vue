<script setup>
import downloadIcon from '@mdi/svg/svg/download.svg?raw'
import axios from '@nextcloud/axios'
import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionCheckbox from '@nextcloud/vue/components/NcActionCheckbox'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { errorMessage } from '../api.js'

const props = defineProps({
	versionId: { type: Number, required: true },
	/** Audio gets the formats of audio workstations, video those of editing applications */
	audioOnly: { type: Boolean, default: false },
	/** A still has no timeline, so only the list makes sense (story 95) */
	still: { type: Boolean, default: false },
})

const VIDEO_FORMATS = [
	{ id: 'edl', label: t('deliver', 'EDL for DaVinci Resolve') },
	{ id: 'fcpx', label: t('deliver', 'FCPXML for Final Cut Pro') },
	{ id: 'fcpxml', label: t('deliver', 'FCP7 XML for Premiere Pro') },
	{ id: 'csv', label: t('deliver', 'CSV') },
]
const AUDIO_FORMATS = [
	{ id: 'wav', label: t('deliver', 'WAV with markers: Logic, Cubase, Nuendo, Sequoia, Pyramix') },
	{ id: 'midi', label: t('deliver', 'MIDI markers: Pro Tools, Cubase, REAPER, Logic') },
	{ id: 'reaper', label: t('deliver', 'REAPER marker list') },
	{ id: 'csv', label: t('deliver', 'CSV: Nuendo, spreadsheets') },
]

const unresolvedOnly = ref(false)
const zeroBased = ref(false)
const liveSetInput = ref(null)
const formats = computed(() => props.still ? VIDEO_FORMATS.filter((format) => format.id === 'csv') : props.audioOnly ? AUDIO_FORMATS : VIDEO_FORMATS)

/** @return {URLSearchParams} the options every export takes, those switched on */
function options() {
	return new URLSearchParams(Object.entries({ unresolvedOnly: unresolvedOnly.value, zeroBased: zeroBased.value })
		.filter(([, on]) => on)
		.map(([name]) => [name, '1']))
}

/**
 * @param {string} format - one of the export formats
 * @return {string} the download URL with the chosen options
 */
function href(format) {
	return generateUrl('/apps/deliver/versions/{id}/export/{format}', { id: props.versionId, format }) + '?' + options()
}

/**
 * Ableton Live imports no marker files, so the person hands in a Live Set of
 * their own and gets it back with the Comments as locators.
 *
 * @param {Event} event - the file input's change event
 */
async function addLocators(event) {
	const set = event.target.files?.[0]
	event.target.value = ''
	if (!set) {
		return
	}
	const form = new FormData()
	form.append('set', set)
	try {
		const url = generateUrl('/apps/deliver/versions/{id}/export/ableton', { id: props.versionId })
		const response = await axios.post(`${url}?${options()}`, form, { responseType: 'blob' })
		const link = document.createElement('a')
		link.href = URL.createObjectURL(response.data)
		link.download = set.name.replace(/\.als$/i, '') + ' with locators.als'
		link.click()
		URL.revokeObjectURL(link.href)
	} catch (e) {
		// The error of a blob request is a blob too
		const text = await e?.response?.data?.text?.().catch(() => null)
		showError((text && JSON.parse(text)?.message) || errorMessage(e))
	}
}
</script>

<template>
	<div>
		<NcActions
			variant="tertiary"
			:aria-label="t('deliver', 'Export')"
			:title="t('deliver', 'Export')"
			:closeAfterClick="false"
			:forceMenu="true">
			<template #icon>
				<NcIconSvgWrapper :svg="downloadIcon" />
			</template>
			<NcActionCheckbox v-model="unresolvedOnly">
				{{ t('deliver', 'Unresolved only') }}
			</NcActionCheckbox>
			<NcActionCheckbox v-model="zeroBased">
				{{ t('deliver', 'Timecode from 00:00:00:00') }}
			</NcActionCheckbox>
			<NcActionSeparator />
			<NcActionLink
				v-for="format in formats"
				:key="format.id"
				:href="href(format.id)"
				download>
				{{ format.label }}
			</NcActionLink>
			<NcActionButton v-if="audioOnly" @click="liveSetInput.click()">
				{{ t('deliver', 'Ableton Live: add locators to a Live Set…') }}
			</NcActionButton>
		</NcActions>
		<input
			ref="liveSetInput"
			type="file"
			accept=".als"
			hidden
			@change="addLocators">
	</div>
</template>
