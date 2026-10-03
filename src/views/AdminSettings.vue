<script setup>
import { t } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { errorMessage, getPipelineSettings, getSupportReport, retryFailedJobs, savePipelineSettings } from '../api.js'
import { useBusy } from '../composables/busy.js'

const ENCODERS = [
	{ id: 'none', label: t('deliver', 'None: software (libx264)') },
	{ id: 'vaapi', label: t('deliver', 'VAAPI: Intel and AMD graphics') },
	{ id: 'nvenc', label: t('deliver', 'NVENC: NVIDIA graphics') },
	{ id: 'videotoolbox', label: t('deliver', 'VideoToolbox: macOS') },
]

const settings = ref(null)
const status = ref(null)
const { busy, error, run } = useBusy()
/** Set after a save, so the encoder test result only shows once it has run */
const saved = ref(false)

const encoder = computed(() => ENCODERS.find((each) => each.id === settings.value?.hwEncoder) ?? ENCODERS[0])
const queue = computed(() => status.value?.states ?? {})

onMounted(async () => {
	try {
		({ settings: settings.value, status: status.value } = await getPipelineSettings())
	} catch (e) {
		error.value = errorMessage(e)
	}
})

/** Puts failed jobs back into the queue, for instance after ffmpeg was fixed */
function retry() {
	return run(async () => {
		status.value = (await retryFailedJobs()).status
	})
}

/** The support report as a JSON file, for a bug report */
function downloadReport() {
	return run(async () => {
		const report = await getSupportReport()
		const link = document.createElement('a')
		link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, '\t')], { type: 'application/json' }))
		link.download = `deliver-report-${report.generated.slice(0, 10)}.json`
		link.click()
		URL.revokeObjectURL(link.href)
	})
}

/** Saves everything; a hardware encoder is tested with a one-second encode on the server */
function save() {
	return run(async () => {
		({ settings: settings.value, status: status.value } = await savePipelineSettings(settings.value))
		saved.value = true
	})
}
</script>

<template>
	<div v-if="settings">
		<NcSettingsSection
			:name="t('deliver', 'Derived media')"
			:description="t('deliver', 'Deliver makes Proxies, Thumbnail Strips and Waveforms with ffmpeg in the background. Without ffmpeg, files the browser plays natively still work.')">
			<form class="deliver-admin" @submit.prevent="save">
				<NcTextField v-model="settings.ffmpegPath" :label="t('deliver', 'Path to ffmpeg')" :placeholder="t('deliver', 'ffmpeg on the PATH')" />
				<NcTextField v-model="settings.ffprobePath" :label="t('deliver', 'Path to ffprobe')" :placeholder="t('deliver', 'ffprobe on the PATH')" />
				<NcTextField
					v-model.number="settings.maxJobs"
					type="number"
					min="1"
					max="16"
					:label="t('deliver', 'Jobs running at the same time')" />
				<NcTextField
					v-model.number="settings.maxHeight"
					type="number"
					min="144"
					max="2160"
					:label="t('deliver', 'Proxy resolution: short side in pixels')"
					:helperText="t('deliver', 'Originals that browsers play are always available. Larger ones also get a lighter Proxy to switch to.')" />
				<NcTextField
					v-model.number="settings.thumbCap"
					type="number"
					min="10"
					max="5000"
					:label="t('deliver', 'Maximum pictures per Thumbnail Strip')" />
				<NcSelect
					:modelValue="encoder"
					:options="ENCODERS"
					:clearable="false"
					:inputLabel="t('deliver', 'Hardware encoder')"
					@update:modelValue="settings.hwEncoder = $event.id" />
				<NcTextField
					v-if="settings.hwEncoder === 'vaapi'"
					v-model="settings.hwDevice"
					:label="t('deliver', 'VAAPI device')" />
				<NcTextField
					v-model="settings.extraArgs"
					:label="t('deliver', 'Extra ffmpeg arguments for Proxies')"
					:helperText="t('deliver', 'Added before the output file, for example -threads 4')" />
				<div>
					<NcButton type="submit" variant="primary" :disabled="busy">
						{{ busy ? t('deliver', 'Saving and testing…') : t('deliver', 'Save') }}
					</NcButton>
				</div>
			</form>

			<NcNoteCard v-if="error" type="error">
				{{ error }}
			</NcNoteCard>
			<template v-else-if="saved && settings.hwEncoder !== 'none'">
				<NcNoteCard v-if="settings.hwEncoderOk" type="success">
					{{ t('deliver', 'The test encode worked. Proxies are made with {encoder}.', { encoder: encoder.label }) }}
				</NcNoteCard>
				<NcNoteCard v-else type="warning">
					{{ t('deliver', 'The test encode failed, so Proxies are made in software until the setting works:') }}
					<pre class="deliver-admin__log">{{ settings.hwEncoderError }}</pre>
				</NcNoteCard>
			</template>
		</NcSettingsSection>

		<NcSettingsSection :name="t('deliver', 'Status')">
			<dl class="deliver-admin__status">
				<dt>ffmpeg</dt>
				<dd>{{ status.ffmpeg ?? t('deliver', 'not found: no Proxies, Thumbnail Strips or Waveforms') }}</dd>
				<dt>ffprobe</dt>
				<dd>{{ status.ffprobe ?? t('deliver', 'not found: frame rates come from the Project setting') }}</dd>
				<dt>{{ t('deliver', 'Encoder in use') }}</dt>
				<dd>{{ status.encoder === 'none' ? 'libx264' : status.encoder }}</dd>
				<dt>{{ t('deliver', 'Queue') }}</dt>
				<dd>
					{{ t('deliver', '{queued} waiting, {running} running, {failed} failed', {
						queued: queue.queued ?? 0,
						running: queue.running ?? 0,
						failed: queue.failed ?? 0,
					}) }}
				</dd>
			</dl>
			<template v-if="status.lastError">
				<h4>{{ t('deliver', 'Last failed job') }}</h4>
				<pre class="deliver-admin__log">{{ status.lastError }}</pre>
			</template>
			<NcButton v-if="queue.failed" :disabled="busy" @click="retry">
				{{ t('deliver', 'Retry failed jobs') }}
			</NcButton>
		</NcSettingsSection>

		<NcSettingsSection
			:name="t('deliver', 'Troubleshooting')"
			:description="t('deliver', 'Failures also go to the Nextcloud log, under the app deliver. For a bug report, attach the support report: versions, settings, the queue and its latest failures, and how many Projects, Versions and links there are. It holds no names, Comments or Reviewers, but ffmpeg errors can show file paths, so read it before you post it.')">
			<NcButton :disabled="busy" @click="downloadReport">
				{{ t('deliver', 'Download support report') }}
			</NcButton>
		</NcSettingsSection>
	</div>
	<NcNoteCard v-else-if="error" type="error">
		{{ error }}
	</NcNoteCard>
</template>

<style scoped>
.deliver-admin {
	display: flex;
	flex-direction: column;
	gap: calc(var(--default-grid-baseline) * 2);
	max-width: 500px;
}

.deliver-admin__status {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: var(--default-grid-baseline) calc(var(--default-grid-baseline) * 4);
}

.deliver-admin__status dt {
	font-weight: bold;
	text-align: start;
}

.deliver-admin__log {
	max-height: 240px;
	overflow: auto;
	white-space: pre-wrap;
	font-family: monospace;
}
</style>
