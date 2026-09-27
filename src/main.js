import { generateUrl } from '@nextcloud/router'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import ProjectView from './views/ProjectView.vue'
import ReviewView from './views/ReviewView.vue'
import WelcomeView from './views/WelcomeView.vue'

const router = createRouter({
	history: createWebHistory(generateUrl('/apps/deliver')),
	routes: [
		{ path: '/', component: WelcomeView },
		{ path: '/projects/:id', component: ProjectView, props: (route) => ({ id: Number(route.params.id) }) },
		{ path: '/versions/:id', component: ReviewView, props: (route) => ({ id: Number(route.params.id) }) },
	],
})

createApp(App)
	.use(createPinia())
	.use(router)
	.mount('#deliver')
