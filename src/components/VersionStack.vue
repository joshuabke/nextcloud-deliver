<script setup>
import { t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionInput from '@nextcloud/vue/components/NcActionInput'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { errorMessage, regenerateVersion, unstackVersion, updateVersion, uploadNextVersion } from '../api.js'
import { uploadFolder } from '../lib/folders.js'
import { previewUrl } from '../lib/preview.js'

const props = defineProps({
	/** The Version Stack of the Asset, newest first */
	versions: { type: Array, required: true },
	current: { type: Number, required: true },
	assetId: { type: Number, required: true },
	canWrite: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'changed'])

const busy = ref(false)
const error = ref(null)
const dragging = ref(false)

/** Where a dropped file goes: the folder of the newest Version that still has a file */
const folderUrl = computed(() => uploadFolder(props.versions))

/**
 * @param {() => Promise<unknown>} action - what to run while the Stack is busy
 */
async function run(action) {
	busy.value = true
	error.value = null
	try {
		await action()
		emit('changed')
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
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
	if (!file || !folderUrl.value || !props.canWrite) {
		return
	}
	await run(() => uploadNextVersion(folderUrl.value, file, props.assetId))
}
</script>

<template>
	<section
		class="deliver-stack"
		:class="{ 'deliver-stack--dragging': dragging }"
		@dragover.prevent="dragging = canWrite"
		@dragleave="dragging = false"
		@drop.prevent="drop">
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<ul class="deliver-stack__list">
			<li
				v-for="version in versions"
				:key="version.id"
				class="deliver-stack__item"
				:class="{ 'deliver-stack__item--current': version.id === current }">
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
					<NcActions v-if="canWrite" :forceMenu="true">
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
				<div v-if="canWrite && version.autoStacked" class="deliver-stack__auto">
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

		<p v-if="canWrite && folderUrl" class="deliver-stack__drop">
			{{ t('deliver', 'Drop a file here to upload it next to the newest Version and stack it on top.') }}
		</p>
	</section>
</template>

<style scoped>
.deliver-stack {
	display: flex;
	flex-direction: column;
	gap: calc(3 * var(--default-grid-baseline, 4px));
	overflow-y: auto;
}

.deliver-stack__list {
	display: flex;
	flex-direction: column;
	gap: calc(2 * var(--default-grid-baseline, 4px));
}

.deliver-stack__item {
	padding: calc(2 * var(--default-grid-baseline, 4px));
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large, 12px);
}

.deliver-stack__item--current {
	border-color: var(--color-primary-element);
	box-shadow: 0 0 0 1px var(--color-primary-element);
}

.deliver-stack__row {
	display: flex;
	align-items: center;
	gap: calc(2 * var(--default-grid-baseline, 4px));
}

.deliver-stack__open {
	display: flex;
	align-items: center;
	gap: calc(3 * var(--default-grid-baseline, 4px));
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
	border-radius: var(--border-radius, 4px);
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
	border-radius: var(--border-radius-pill, 20px);
	background: var(--color-warning);
	color: var(--color-warning-text, #000);
	font-size: 12px;
}

.deliver-stack__auto {
	display: flex;
	align-items: center;
	gap: var(--default-grid-baseline, 4px);
	margin-top: calc(2 * var(--default-grid-baseline, 4px));
	padding-top: calc(2 * var(--default-grid-baseline, 4px));
	border-top: 1px solid var(--color-border);
	font-size: 13px;
}

.deliver-stack__auto span {
	flex: 1;
}

.deliver-stack__drop {
	padding: calc(4 * var(--default-grid-baseline, 4px));
	border: 2px dashed var(--color-border-dark);
	border-radius: var(--border-radius-large, 12px);
	color: var(--color-text-maxcontrast);
	text-align: center;
}

.deliver-stack--dragging .deliver-stack__drop {
	border-color: var(--color-primary-element);
	background: var(--color-primary-element-light);
	color: var(--color-main-text);
}
</style>
