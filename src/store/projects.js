import { t } from '@nextcloud/l10n'
import { defineStore } from 'pinia'
import { createNamedProject, createProject, getProject, listProjects, muteProject, removeProject, updateProject } from '../api.js'

/**
 * @param {object} project - a Project as the server sends it
 * @return {object} the same, with No Project named in the reader's language
 */
const named = (project) => project.none ? { ...project, name: t('deliver', 'No Project') } : project

export const useProjectsStore = defineStore('projects', {
	state: () => ({
		projects: [],
		/** Project id → Project with its Asset tree */
		details: {},
		loaded: false,
	}),
	actions: {
		async fetchAll() {
			this.projects = (await listProjects()).map(named)
			this.loaded = true
		},
		async fetch(id) {
			this.details[id] = named(await getProject(id))
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
		 * @param {string} name - what to call it
		 * @return {Promise<object>} the new Project, which collects files from anywhere
		 */
		async createNamed(name) {
			const project = await createNamedProject(name)
			await this.fetchAll()
			return project
		},
		/**
		 * @param {number} id - the Project
		 * @param {object} fields - settings to change
		 * @param {boolean} [fields.muted] - my notifications from this Project, instead of a setting
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
