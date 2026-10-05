<script setup>
import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionInput from '@nextcloud/vue/components/NcActionInput'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { regenerateVersion, unstackVersion, updateVersion, uploadNextVersion } from '../api.js'
import { useBusy } from '../composables/busy.js'
import { stackKind } from '../lib/media.js'
import { previewUrl } from '../lib/preview.js'

const props = defineProps({
	/** The Version Stack of the Asset, newest first */
	versions: { type: Array, required: true },
	assetId: { type: Number, required: true },
	/** The WebDAV folder a dropped file goes to, next to the newest Version */
	folderUrl: { type: String, required: true },
})

const emit = defineEmits(['open', 'changed'])

const { busy, error, run: runBusy } = useBusy()
const dragging = ref(false)

/**
 * @param {() => Promise<unknown>} action - a change to the Stack, which is reloaded after it
 */
function run(action) {
	return runBusy(async () => {
		await action()
		emit('changed')
	})
}

/** Version id → the number typed into its menu, until it is submitted */
const numbers = ref({})

/**
 * @param {object} version - the Version to renumber
 */
async function renumber(version) {
	const number = Number(numbers.value[version.id] ?? version.number)
	if (number === version.number) {
		return
	}
	if (!Number.isInteger(number) || number < 1) {
		error.value = t('deliver', 'A Version Number is a whole number from 1 up.')
		return
	}
	await run(() => updateVersion(version.id, { number }))
	delete numbers.value[version.id]
}

/**
 * Uploads the dropped file next to the newest Version and stacks it as the
 * next one (story 17).
 *
 * @param {DragEvent} event - the drop
 */
async function drop(event) {
	dragging.value = false
	const file = event.dataTransfer?.files?.[0]
	if (!file) {
		return
	}
	await run(() => uploadNextVersion(props.folderUrl, file, props.assetId, stackKind(props.versions)))
}
</script>

<template>
	<section
		class="deliver-stack"
		:class="{ 'deliver-stack--dragging': dragging }"
		@dragover.prevent="dragging = true"
		@dragleave="dragging = false"
		@drop.prevent="drop">
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<ul class="deliver-stack__list">
			<li
				v-for="version in versions"
				:key="version.id"
				class="deliver-stack__item">
				<div class="deliver-stack__row">
					<button type="button" class="deliver-stack__open" @click="emit('open', version.id)">
						<img
							v-if="version.state === 'ready'"
							class="deliver-stack__still"
							:src="previewUrl(version.fileId)"
							alt=""
							@error="$event.target.style.visibility = 'hidden'">
						<span v-else class="deliver-stack__still" />
						<span class="deliver-stack__text">
							<strong>{{ t('deliver', 'Version {number}', { number: version.number }) }}</strong>
							<span class="deliver-stack__file">{{ version.name }}</span>
						</span>
					</button>
					<span v-if="version.state === 'missing'" class="deliver-stack__badge">{{ t('deliver', 'Missing') }}</span>
					<NcActions :forceMenu="true">
						<NcActionInput
							type="number"
							:modelValue="String(numbers[version.id] ?? version.number)"
							:label="t('deliver', 'Version Number')"
							:disabled="busy"
							@update:modelValue="numbers[version.id] = $event"
							@submit="renumber(version)" />
						<NcActionButton v-if="versions.length > 1 && !version.autoStacked" :disabled="busy" @click="run(() => unstackVersion(version.id))">
							{{ t('deliver', 'Unstack into its own Asset') }}
						</NcActionButton>
						<NcActionButton v-if="version.state === 'ready'" :disabled="busy" @click="run(() => regenerateVersion(version.id))">
							{{ t('deliver', 'Regenerate Proxy, Thumbnail Strip and Waveform') }}
						</NcActionButton>
					</NcActions>
				</div>
				<!-- An automatic stack stays visible until a Member keeps or undoes it (story 13) -->
				<div v-if="version.autoStacked" class="deliver-stack__auto">
					<span>{{ t('deliver', 'Stacked automatically, going by its name') }}</span>
					<NcButton variant="tertiary" :disabled="busy" @click="run(() => unstackVersion(version.id))">
						{{ t('deliver', 'Undo') }}
					</NcButton>
					<NcButton variant="secondary" :disabled="busy" @click="run(() => updateVersion(version.id, { autoStacked: false }))">
						{{ t('deliver', 'Keep') }}
					</NcButton>
				</div>
			</li>
		</ul>

		<p class="deliver-stack__drop">
			{{ t('deliver', 'Drop a file here to upload it next to the newest Version and stack it on top.') }}
		</p>
	</section>
</template>

<style scoped>
.deliver-stack {
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline));
	overflow-y: auto;
}

.deliver-stack__list {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-stack__item {
	padding: calc(2 * var(--default-grid-baseline));
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);
}

.deliver-stack__row {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline));
}

.deliver-stack__open {
	display: flex;
	align-items: center;
	gap: calc(3 * var(--default-grid-baseline));
	flex: 1;
	min-width: 0;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--color-main-text);
	text-align: start;
	cursor: pointer;
}

.deliver-stack__still {
	flex: none;
	width: 80px;
	height: 45px;
	object-fit: cover;
	border-radius: var(--border-radius);
	background: var(--color-background-dark);
}

.deliver-stack__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.deliver-stack__file {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.deliver-stack__badge {
	padding: 0 8px;
	border-radius: var(--border-radius-pill);
	background: var(--color-warning);
	color: var(--color-warning-text);
	font-size: 12px;
}

.deliver-stack__auto {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline);
	margin-top: calc(2 * var(--default-grid-baseline));
	padding-top: calc(2 * var(--default-grid-baseline));
	border-top: 1px solid var(--color-border);
	font-size: 13px;
}

.deliver-stack__auto span {
	flex: 1;
}

.deliver-stack__drop {
	padding: calc(4 * var(--default-grid-baseline));
	border: 2px dashed var(--color-border-dark);
	border-radius: var(--border-radius-large);
	color: var(--color-text-maxcontrast);
	text-align: center;
}

.deliver-stack--dragging .deliver-stack__drop {
	border-color: var(--color-primary-element);
	background: var(--color-primary-element-light);
	color: var(--color-main-text);
}
</style>
