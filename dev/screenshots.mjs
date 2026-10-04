/**
 * The App Store screenshots (docs/screenshots/), taken from the dev instance
 * with footage from Tears of Steel, (CC) Blender Foundation | mango.blender.org.
 *
 * node dev/screenshots.mjs
 *
 * Needs `make up`, ffmpeg, and the headless browser the e2e tests use
 * (DELIVER_CDP, DELIVER_BROWSER_URL as there). Recreates the users sarah and
 * leo on every run, so their files and Projects start clean.
 *
 * chromedp/headless-shell carries only DejaVu, and no emoji: copy Noto Sans,
 * Noto Sans Mono and Noto Color Emoji (github.com/google/fonts, ofl/) into
 * its /usr/share/fonts and restart it, or the shots look off and Reactions
 * show as boxes.
 */
import { chromium, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const URL = process.env.DELIVER_TEST_URL ?? 'http://localhost:8080'
const BROWSER_URL = process.env.DELIVER_BROWSER_URL ?? URL
const CDP = process.env.DELIVER_CDP ?? 'http://127.0.0.1:9222'
const ADMIN = { username: 'admin', password: process.env.DELIVER_TEST_PASSWORD ?? 'adminadmin123', send: 'always' }
const MEDIA = process.env.DELIVER_SHOTS_MEDIA ?? '/tmp/deliver-shots-media'
const OUT = new globalThis.URL('../docs/screenshots/', import.meta.url).pathname
const FILM = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov'
const OCS = { 'OCS-APIREQUEST': 'true', Accept: 'application/json' }
const API = '/ocs/v2.php/apps/deliver/api/v1'

const USERS = {
	sarah: { name: 'Sarah Chen', password: 'shots-' + randomBytes(12).toString('hex') },
	leo: { name: 'Leo Park', password: 'shots-' + randomBytes(12).toString('hex') },
}

/** file name: [start in the film, seconds, extra ffmpeg arguments] */
const CLIPS = {
	'TOS_0405_closeup_v1.webm': [396, 16, ['-vf', 'eq=contrast=0.72:saturation=0.5:brightness=0.05']],
	'TOS_0405_closeup_v2.webm': [396, 16, []],
	'TOS_0030_bridge_v1.webm': [24, 20, []],
	'TOS_0195_lab_v1.webm': [190, 20, []],
	'TOS_0090_scope_v1.webm': [84, 16, []],
}

/** Cuts the clips from the film, once: WebM, because the headless browser has no H.264 */
function media() {
	mkdirSync(MEDIA, { recursive: true })
	const film = join(MEDIA, 'tos720.mov')
	if (!existsSync(film)) {
		execFileSync('curl', ['-fsSL', '-o', film, FILM], { stdio: 'inherit' })
	}
	const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])
	for (const [name, [start, seconds, extra]] of Object.entries(CLIPS)) {
		if (!existsSync(join(MEDIA, name))) {
			ffmpeg('-ss', start, '-t', seconds, '-i', film, ...extra, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '1500k', '-c:a', 'libopus', '-b:a', '96k', join(MEDIA, name))
		}
	}
	if (!existsSync(join(MEDIA, 'TOS_mix_stereo.wav'))) {
		ffmpeg('-ss', '30', '-t', '45', '-i', film, '-vn', '-ac', '2', '-ar', '48000', join(MEDIA, 'TOS_mix_stereo.wav'))
	}
	if (!existsSync(join(MEDIA, 'TOS_poster_still.png'))) {
		ffmpeg('-ss', '409', '-i', film, '-frames:v', '1', join(MEDIA, 'TOS_poster_still.png'))
	}
}

/**
 * @param {Response|import('@playwright/test').APIResponse} response - an OCS answer
 * @return {Promise<object>} its data, or an error with the body
 */
async function ocs(response) {
	if (!response.ok()) {
		throw new Error(`${response.status()} ${response.url()}: ${await response.text()}`)
	}
	return (await response.json()).ocs?.data
}

/** Sarah and Leo, fresh, in English */
async function users() {
	const admin = await request.newContext({ baseURL: URL, httpCredentials: ADMIN, extraHTTPHeaders: OCS })
	for (const [id, { name, password }] of Object.entries(USERS)) {
		await admin.delete(`/ocs/v2.php/cloud/users/${id}?format=json`)
		await ocs(await admin.post('/ocs/v2.php/cloud/users?format=json', { form: { userid: id, password, displayName: name } }))
		await ocs(await admin.put(`/ocs/v2.php/cloud/users/${id}?format=json`, { form: { key: 'language', value: 'en' } }))
		await ocs(await admin.put(`/ocs/v2.php/cloud/users/${id}?format=json`, { form: { key: 'locale', value: 'en_US' } }))
	}
	await admin.dispose()
}

/** @param {string} id - user id */
async function as(id) {
	return request.newContext({ baseURL: URL, httpCredentials: { username: id, password: USERS[id].password, send: 'always' }, extraHTTPHeaders: OCS })
}

/**
 * @param {import('@playwright/test').APIRequestContext} api - as the owner
 * @param {string} path - folder below the user's root
 * @return {Promise<number>} its file id
 */
async function fileId(api, path) {
	const response = await api.fetch(`/remote.php/dav/files/sarah/${path}`, {
		method: 'PROPFIND',
		headers: { Depth: '0', 'Content-Type': 'application/xml' },
		data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
	})
	return Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(await response.text())[1])
}

/** Two Projects of Sarah's, shared with Leo, with Comments, Approvals and a Reviewer */
async function seed() {
	const sarah = await as('sarah')
	const put = (path, file) => sarah.fetch(`/remote.php/dav/files/sarah/${path}`, { method: 'PUT', data: readFileSync(join(MEDIA, file)) })
	const folders = { cut: 'Tears of Steel', trailer: 'Tears of Steel – Trailer', sound: 'Tears of Steel – Sound' }
	for (const folder of Object.values(folders)) {
		await sarah.fetch(`/remote.php/dav/files/sarah/${encodeURIComponent(folder)}`, { method: 'MKCOL' })
		await ocs(await sarah.post('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
			form: { path: `/${folder}`, shareType: 0, shareWith: 'leo', permissions: 31 },
		}))
	}
	const cut = encodeURIComponent(folders.cut)
	for (const file of ['TOS_0030_bridge_v1.webm', 'TOS_0090_scope_v1.webm', 'TOS_0195_lab_v1.webm', 'TOS_0405_closeup_v1.webm', 'TOS_poster_still.png']) {
		await put(`${cut}/${file}`, file)
	}
	await put(`${encodeURIComponent(folders.sound)}/TOS_mix_stereo.wav`, 'TOS_mix_stereo.wav')
	await put(`${encodeURIComponent(folders.trailer)}/TOS_trailer_v1.webm`, 'TOS_0195_lab_v1.webm')

	const enable = async (folder) => ocs(await sarah.post(`${API}/projects?format=json`, { data: { folderId: await fileId(sarah, encodeURIComponent(folder)), autoIntake: true } }))
	await enable(folders.sound)
	await enable(folders.trailer)
	const project = await enable(folders.cut)
	const leo = await as('leo')
	const comment = async (api, version, fields) => ocs(await api.post(`${API}/versions/${version.id}/comments?format=json`, { data: fields }))
	const tree = async () => (await ocs(await sarah.get(`${API}/projects/${project.id}?format=json`))).assets
	const [flat] = (await tree()).find((a) => a.name === 'TOS_0405_closeup').versions
	await comment(leo, flat, { inFrame: 24, body: 'Flat log plate, grade pending.' })
	// The graded cut arrives later and stacks onto the flat one; only the newest takes Comments
	await put(`${cut}/TOS_0405_closeup_v2.webm`, 'TOS_0405_closeup_v2.webm')
	const assets = await tree()
	const asset = (name) => assets.find((a) => a.name === name)
	const closeup = asset('TOS_0405_closeup')
	const graded = closeup.versions.find((v) => v.id !== flat.id)

	// Frames of the close-up: the arm 0–71, the lab 96–191 and 312–384, the hologram 192–300
	await comment(sarah, graded, {
		inFrame: 30,
		body: 'Arm needs more motion blur on the way up.',
		annotation: [{ tool: 'arrow', color: '#ff3b30', points: [[0.92, 0.88], [0.7, 0.5]] }],
	})
	await comment(leo, graded, { inFrame: 130, body: 'Skin tones sit well now, much better than v1.' })
	const first = await comment(leo, graded, {
		inFrame: 210,
		outFrame: 290,
		body: 'Hologram text drifts against the background here, needs a tighter track.',
		annotation: [{ tool: 'box', color: '#ffcc00', points: [[0.45, 0.2], [0.89, 0.6]] }],
	})
	await comment(sarah, graded, { inFrame: 210, body: 'Agreed, I\'ll send it back to VFX with the new plate.', parentId: first.id })
	await ocs(await leo.put(`${API}/comments/${first.id}/reactions?format=json`, { data: { emoji: '👍' } }))
	await ocs(await sarah.put(`${API}/assets/${closeup.id}?format=json`, { data: { dueDate: '2026-10-09' } }))
	await ocs(await sarah.put(`${API}/assets/${asset('TOS_0195_lab').id}?format=json`, { data: { dueDate: '2026-10-14' } }))
	await ocs(await leo.put(`${API}/versions/${asset('TOS_0030_bridge').versions[0].id}/approval?format=json`, { data: { status: 'approved' } }))
	await comment(leo, asset('TOS_0090_scope').versions[0], { inFrame: 60, body: 'Scope reticle flickers for two frames.' })

	// A Project Link for the client, and her own Personal Link
	const link = await ocs(await sarah.post(`${API}/projects/${project.id}/links?format=json`))
	await ocs(await sarah.put(`${API}/links/${link.id}?format=json`, { data: { watermark: true } }))
	const reviewer = await ocs(await sarah.post(`${API}/links/${link.id}/reviewers?format=json`, { data: { name: 'Ines Visser' } }))
	const client = await request.newContext({ baseURL: URL })
	const personal = new globalThis.URL(reviewer.link ?? reviewer.personalLink)
	await client.get(personal.pathname + personal.search)
	const token = personal.pathname.split('/').pop()
	const pub = (path, data, method = 'post') => client[method](`/apps/deliver/s/${token}/api${path}`, { data })
	const asked = await pub(`/versions/${graded.id}/comments`, { inFrame: 312, outFrame: 380, body: 'Can we hold on his reaction a little longer before the cut?' })
	if (!asked.ok()) {
		throw new Error(`Reviewer comment: ${asked.status()} ${await asked.text()}`)
	}
	await pub(`/versions/${graded.id}/approval`, { status: 'changes' }, 'put')

	await Promise.all([sarah.dispose(), leo.dispose(), client.dispose()])
	return { project, flat, graded, personal: personal.pathname + personal.search, token }
}

/** Derived media for everything just uploaded, before the browser looks */
function worker() {
	execFileSync('docker', ['compose', 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once'], { stdio: 'inherit' })
}

/**
 * @param {object} seeded - what seed() made
 * @param {{id: number}} seeded.project - the cut's Project
 * @param {{id: number}} seeded.flat - the close-up's v1
 * @param {{id: number}} seeded.graded - the close-up's v2
 * @param {string} seeded.personal - the Reviewer's Personal Link, path and query
 * @param {string} seeded.token - the Project Link's token
 */
async function shoot({ project, flat, graded, personal, token }) {
	mkdirSync(OUT, { recursive: true })
	const browser = await chromium.connectOverCDP(CDP)
	const desktop = await browser.newContext({ baseURL: BROWSER_URL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
	const page = await desktop.newPage()
	await page.goto('/index.php/login')
	await page.locator('#user').fill('sarah')
	await page.locator('#password').fill(USERS.sarah.password)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.waitForURL(/apps|dashboard/)

	const settle = () => page.waitForTimeout(1500)
	await page.goto(`/apps/deliver/versions/${graded.id}`)
	await page.locator('.deliver-comment', { hasText: 'Hologram' }).locator('.deliver-comment__anchor').first().click()
	await settle()
	await page.screenshot({ path: join(OUT, 'review.png') })

	await page.goto(`/apps/deliver/projects/${project.id}`)
	await settle()
	await page.screenshot({ path: join(OUT, 'project.png') })

	await page.goto(`/apps/deliver/compare/${flat.id}/${graded.id}`)
	await page.getByRole('radio', { name: 'Wipe' }).or(page.getByRole('button', { name: 'Wipe' })).first().click()
	await page.locator('.deliver-compare-view__anchor').first().click()
	await settle()
	await page.screenshot({ path: join(OUT, 'compare.png') })

	await page.goto('/apps/deliver/')
	await settle()
	await page.screenshot({ path: join(OUT, 'projects.png') })

	const client = await browser.newContext({ baseURL: BROWSER_URL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
	const guest = await client.newPage()
	await guest.goto(personal)
	await guest.goto(`/apps/deliver/s/${token}/versions/${graded.id}`)
	await guest.waitForTimeout(2500)
	await guest.screenshot({ path: join(OUT, 'reviewer.png') })

	// An iPhone as Nextcloud accepts it, with Sarah's session
	const phone = await browser.newContext({
		baseURL: BROWSER_URL,
		storageState: await desktop.storageState(),
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
	})
	const mobile = await phone.newPage()
	await mobile.goto(`/apps/deliver/versions/${graded.id}`)
	// The Comment list halfway up under the picture, standing on the hologram
	await mobile.locator('.deliver-layout__grabber').tap()
	await mobile.locator('.deliver-comment', { hasText: 'Hologram' }).locator('.deliver-comment__anchor').first().tap()
	await mobile.waitForTimeout(2500)
	await mobile.screenshot({ path: join(OUT, 'phone.png') })

	await browser.close()
}

media()
await users()
const seeded = await seed()
worker()
await shoot(seeded)
process.stdout.write(`Screenshots in ${OUT}\n`)
