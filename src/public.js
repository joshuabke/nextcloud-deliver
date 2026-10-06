import { loadState } from '@nextcloud/initial-state'
import { getLanguage } from '@nextcloud/l10n'
import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import PublicReviewView from './views/PublicReviewView.vue'
import { usePublicApi } from './api.js'
import { chosenLanguage, languageRedirect } from './lib/language.js'
import { usePublicPreviews } from './lib/preview.js'

import '@nextcloud/dialogs/style.css'

// Reviewers reach Deliver through the link's token, never through OCS (ADR 0011)
const token = loadState('deliver', 'token')
usePublicApi(token)
usePublicPreviews(token)

const versionId = loadState('deliver', 'versionId', null)
const link = loadState('deliver', 'link', { title: '', description: null, reviewer: null, downloadAll: null, memberUrl: null })

// The language chosen on an earlier visit, unless the page already speaks it
const elsewhere = languageRedirect(window.location.href, chosenLanguage(), getLanguage())
if (elsewhere) {
	window.location.replace(elsewhere)
} else {
	createApp({ render: () => h(PublicReviewView, { versionId, link }) })
		.use(createPinia())
		.mount('#deliver-public')
}
