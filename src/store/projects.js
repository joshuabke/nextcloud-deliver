import { defineStore } from 'pinia'
import { createProject, getProject, listProjects, muteProject, removeProject, updateProject } from '../api.js'

export const useProjectsStore = defineStore('projects', {
	state: () => ({
		projects: [],
		/** Project id → Project with its Asset tree */
		details: {},
		loaded: false,
	}),
	actions: {
		async fetchAll() {
			this.projects = await listProjects()
			this.loaded = true
		},
		async fetch(id) {
			const project = await getProject(id)
			this.details[id] = project
			return project
		},
		/**
		 * @param {number} folderId - the folder to turn into a Project
		 * @return {Promise<object>} the new Project
		 */
		async create(folderId) {
			const project = await createProject(folderId, true)
			await this.fetchAll()
			return project
		},
		/**
		 * @param {number} id - the Project
		 * @param {object} fields - settings to change, or muted
		 * @param fields.muted
		 */
		async save(id, { muted, ...settings }) {
			const changed = muted === undefined ? await updateProject(id, settings) : await muteProject(id, muted)
			for (const project of [this.projects.find((each) => each.id === id), this.details[id]]) {
				if (project) {
					Object.assign(project, changed)
				}
			}
		},
		async remove(id) {
			await removeProject(id)
			this.projects = this.projects.filter((each) => each.id !== id)
			delete this.details[id]
		},
	},
})
