import { loadState } from '@nextcloud/initial-state'
import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import PublicReviewView from './views/PublicReviewView.vue'
import { usePublicApi } from './api.js'
import { usePublicPreviews } from './lib/preview.js'

// Reviewers reach Deliver through the share token, never through OCS (ADR 0004)
const token = loadState('deliver', 'token')
usePublicApi(token)
usePublicPreviews(token)

const versionId = loadState('deliver', 'versionId', null)

createApp({ render: () => h(PublicReviewView, { versionId }) })
	.use(createPinia())
	.mount('#deliver-public')
