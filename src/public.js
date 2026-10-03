import { loadState } from '@nextcloud/initial-state'
import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import PublicReviewView from './views/PublicReviewView.vue'
import { usePublicApi } from './api.js'
import { usePublicPreviews } from './lib/preview.js'

import '@nextcloud/dialogs/style.css'

// Reviewers reach Deliver through the share token, never through OCS (ADR 0004)
const token = loadState('deliver', 'token')
usePublicApi(token)
usePublicPreviews(token)

const versionId = loadState('deliver', 'versionId', null)
const link = loadState('deliver', 'link', { title: '', description: null, reviewer: null, downloadAll: null })

createApp({ render: () => h(PublicReviewView, { versionId, link }) })
	.use(createPinia())
	.mount('#deliver-public')
