<script setup>
import deleteIcon from '@mdi/svg/svg/trash-can-outline.svg?raw'
import { getLanguage } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { errorMessage, getVersion, giveCaptions, removeCaptions } from '../api.js'
import { COMMON_LANGUAGES, isCaptionsFile, languageName, languageOfName, MAX_BYTES, toWebVtt } from '../lib/captions.js'
import { t } from '../lib/l10n.js'
import { uploadNextTo } from '../lib/proxy.js'

const props = defineProps({
	/** The Version, with its id and the WebDAV URL of its file */
	version: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const locale = getLanguage()
/** The languages it has Captions in; null while they load */
const present = ref(null)
const file = ref(null)
const fileInput = ref(null)
const language = ref(null)
const busy = ref(false)
const error = ref(null)

const options = computed(() => COMMON_LANGUAGES
	.map((id) => ({ id, label: languageName(id, locale) }))
	.sort((a, b) => a.label.localeCompare(b.label)))

onMounted(async () => {
	try {
		const context = await getVersion(props.version.id)
		present.value = context.versions.find((each) => each.id === props.version.id)?.captions.map((each) => each.language) ?? []
	} catch (e) {
		error.value = errorMessage(e)
	}
})

/**
 * Checks the picked file in the browser first, so the message is the user's own language
 *
 * @param {Event} event - the file field changed
 */
async function pick(event) {
	error.value = null
	const [picked] = event.target.files
	file.value = null
	if (!picked) {
		return
	}
	if (!isCaptionsFile(picked.name)) {
		error.value = t('deliver', 'Captions are an .srt or .vtt file.')
	} else if (picked.size > MAX_BYTES) {
		error.value = t('deliver', 'A Captions file has at most 1 MB.')
	} else if (toWebVtt(await picked.text()) === null) {
		error.value = t('deliver', 'Not a single cue could be read from this file.')
	} else {
		file.value = picked
		const named = languageOfName(picked.name)
		if (named) {
			language.value = { id: named, label: languageName(named, locale) }
		}
	}
}

/** Uploads the file next to the Version's and hands it in as Captions in the chosen language */
async function add() {
	busy.value = true
	error.value = null
	try {
		const fileId = await uploadNextTo(props.version.url, file.value, {}, new AbortController().signal, '.deliver-captions-')
		const shown = await giveCaptions(props.version.id, fileId, language.value.id)
		present.value = shown.captions.map((each) => each.language)
		file.value = null
		fileInput.value.value = ''
		language.value = null
	} catch (e) {
		error.value = errorMessage(e)
	} finally {
		busy.value = false
	}
}

/**
 * @param {string} tag - the language whose Captions go
 */
async function remove(tag) {
	error.value = null
	try {
		present.value = (await removeCaptions(props.version.id, tag)).captions.map((each) => each.language)
	} catch (e) {
		error.value = errorMessage(e)
	}
}
</script>

<template>
	<NcDialog :name="t('deliver', 'Captions')" size="small" @closing="emit('close')">
		<ul v-if="present?.length" class="deliver-captions__list">
			<li v-for="tag in present" :key="tag">
				<span>{{ languageName(tag, locale) }}</span>
				<NcButton variant="tertiary" :aria-label="t('deliver', 'Remove the Captions in {language}', { language: languageName(tag, locale) })" @click="remove(tag)">
					<template #icon>
						<NcIconSvgWrapper :svg="deleteIcon" />
					</template>
				</NcButton>
			</li>
		</ul>
		<form id="deliver-captions" class="deliver-captions" @submit.prevent="file && language && add()">
			<input
				ref="fileInput"
				type="file"
				accept=".srt,.vtt"
				:aria-label="t('deliver', 'Captions file')"
				@change="pick">
			<NcSelect
				v-model="language"
				:options="options"
				:clearable="false"
				:inputLabel="t('deliver', 'Language')" />
			<p class="deliver-captions__hint">
				{{ t('deliver', 'SRT or WebVTT, at most 1 MB. A file named like cut.de.srt brings its language. A new file replaces the Captions in its language.') }}
			</p>
			<NcNoteCard v-if="error" type="error">
				{{ error }}
			</NcNoteCard>
		</form>
		<template #actions>
			<NcButton
				type="submit"
				form="deliver-captions"
				variant="primary"
				:disabled="!file || !language || busy">
				{{ t('deliver', 'Add Captions') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.deliver-captions,
.deliver-captions__list {
	display: flex;
	flex-direction: column;
	gap: var(--default-grid-baseline);
	padding-bottom: calc(2 * var(--default-grid-baseline));
}

.deliver-captions__list li {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.deliver-captions__hint {
	color: var(--color-text-maxcontrast);
}
</style>
