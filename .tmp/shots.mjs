import { chromium, request } from '/home/factory/projects/nextcloud-deliver/.claude/worktrees/bubbles/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const ROOT = '/home/factory/projects/nextcloud-deliver/.claude/worktrees/bubbles'
const { CLIP, LONG, LONG_MIX } = await import(ROOT + '/tests/e2e/fixtures.js')
const URL = 'http://localhost:8353'
const OUT = '/home/factory/.local/share/nextcloud-deliver-night/shots/250/'
const dc = (...args) => execFileSync('docker', ['compose', 'exec', '-T', ...args], { cwd: ROOT, encoding: 'utf8' })
const api = await request.newContext({ baseURL: URL, httpCredentials: { username: 'admin', password: 'adminadmin123', send: 'always' }, extraHTTPHeaders: { 'OCS-APIREQUEST': 'true', Accept: 'application/json' } })
for (const [id, name] of [['anna', 'Anna Berg'], ['kim', 'Kim Olsen'], ['wim', 'Wim Moss']]) {
	await api.post('/ocs/v2.php/cloud/users?format=json', { data: { userid: id, displayName: name, password: 'Some-long-pass-9371' } })
}
const dav = '/remote.php/dav/files/admin/shots'
let project
await api.fetch(dav, { method: 'DELETE' })
await api.fetch(dav, { method: 'MKCOL' })
for (const [name, file] of [['video.webm', LONG], ['audio.webm', LONG_MIX], ['video-many.webm', LONG], ['audio-many.webm', LONG_MIX]]) {
	await api.fetch(`${dav}/${name}`, { method: 'PUT', data: Buffer.concat([readFileSync(file)]) })
}
const prop = await (await api.fetch(dav, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>' })).text()
const made = await (await api.post('/ocs/v2.php/apps/deliver/api/v1/projects?format=json', { data: { folderId: Number(/<oc:fileid>(\d+)/.exec(prop)[1]), autoIntake: true } })).json()
project = made.ocs.data.id
const assets = (await (await api.get(`/ocs/v2.php/apps/deliver/api/v1/projects/${project}?format=json`)).json()).ocs.data.assets
const v = Object.fromEntries(assets.map((a) => [a.name, a.versions[0].id]))
dc('-u', 'www-data', 'nextcloud', 'php', 'occ', 'deliver:worker', '--once')
const comment = async (version, inFrame, body, outFrame = null) => (await (await api.post(`/ocs/v2.php/apps/deliver/api/v1/versions/${version}/comments?format=json`, { data: { inFrame, outFrame, body } })).json()).ocs.data.id
const few = [0.06, 0.2, 0.36, 0.365, 0.5, 0.7, 0.94]
for (const [name, frames] of [['video', 750], ['audio', 360000]]) {
	for (const [i, share] of few.entries()) {
		const at = Math.round(share * frames)
		const id = await comment(v[name], at, ['Music a little louder here', 'Cut earlier?', 'Breath before the line', 'And this click', 'Lovely', 'Too dark', 'Fade out longer'][i], i === 4 ? at + Math.round(frames * 0.08) : null)
		if (i === 5) await api.put(`/ocs/v2.php/apps/deliver/api/v1/comments/${id}/resolved?format=json`, { data: { resolved: true } })
	}
	for (let i = 0; i < 60; i++) {
		await comment(v[name + '-many'], Math.round((i + 0.5) / 60 * frames), 'Note ' + (i + 1))
	}
}
dc('db', 'psql', '-U', 'nextcloud', '-c', "update oc_deliver_comments set user_id = (array['admin','anna','kim','wim'])[1 + id % 4] where version_id in (" + Object.values(v).join(',') + ')')
console.log(JSON.stringify(v))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9353')
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'
const devices = {
	phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA },
	side: { viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA },
	desk: { viewport: { width: 1440, height: 900 } },
}
for (const [device, options] of Object.entries(devices)) {
	const context = await browser.newContext({ baseURL: URL, ...options })
	const page = await context.newPage()
	await page.goto('/index.php/login')
	await page.locator('#user').fill('admin')
	await page.locator('#password').fill('adminadmin123')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.waitForURL(/apps|dashboard/)
	const open = async (version, zoom) => {
		await page.goto(`/apps/deliver/versions/${version}`)
		await page.locator('video.deliver-player__video').waitFor()
		await page.waitForTimeout(1500)
		if (zoom) await page.getByRole('button', { name: zoom, exact: true }).click()
		await page.waitForTimeout(500)
	}
	const seek = (share) => page.locator('video.deliver-player__video').evaluate((e, s) => { e.currentTime = e.duration * s }, share)
	const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}A3-${device}-${name}.png` }) }
	const bar = () => page.locator('.deliver-player__timeline').boundingBox()
	for (const [name, version, zoom] of [['audio-whole', v.audio, 'Whole'], ['audio-1min', v.audio, '1 min'], ['video', v.video], ['audio-1min-many', v['audio-many'], '1 min'], ['audio-whole-many', v['audio-many'], 'Whole'], ['video-many', v['video-many']]]) {
		await open(version, zoom)
		await seek(0.42)
		await shot(name)
	}
	for (const [name, version, zoom] of [['audio-1min-card', v.audio, '1 min'], ['video-card', v.video]]) {
		await open(version, zoom)
		const box = await page.locator('.deliver-player__marker').nth(1).boundingBox()
		const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
		if (options.hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y)
		await shot(name)
	}
	// 60 Comments: where a press seeks, where it opens, and a drag from every circle
	for (const [name, version, zoom] of [['video-many', v['video-many']], ['audio-many 1 min', v['audio-many'], '1 min']]) {
		await open(version, zoom)
		const b = await bar()
		const centres = await page.locator('.deliver-player__marker').evaluateAll((all) => all.map((e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2 }))
		let free = 0, line = 0, n = 0
		for (let x = b.x + 0.5; x < b.x + b.width; x++) {
			n++
			line += centres.every((c) => Math.abs(c - x) > 10)
			for (let y = 0.5; y < b.height; y++) free += centres.every((c) => Math.hypot(c - x, y - b.height / 2) > 10)
		}
		const cdp = await context.newCDPSession(page)
		const time = () => page.locator('video.deliver-player__video').evaluate((e) => [e.currentTime, e.duration])
		let exact = 0, opened = 0, tapped = 0
		for (const c of centres) {
			const y = b.y + b.height / 2
			const dx = c + 30 < b.x + b.width ? 30 : -30
			if (options.hasTouch) {
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c, y }] })
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c + dx, y }] })
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
			} else {
				await page.mouse.move(c, y); await page.mouse.down(); await page.mouse.move(c + dx, y, { steps: 3 }); await page.mouse.up()
			}
			await page.waitForTimeout(150)
			const [at, duration] = await time()
			if (Math.abs(at / duration * b.width + b.x - (c + dx)) < b.width / duration / 25 + 1) exact++
			opened += await page.locator('.deliver-player__peek--tapped, .deliver-wave-card').count()
		}
		// A tap near the bar's upper edge seeks even right over a circle
		if (options.hasTouch) {
			for (const c of centres) {
				await page.touchscreen.tap(c, b.y + 3)
				await page.waitForTimeout(150)
				const [at, duration] = await time()
				if (Math.abs(at / duration * b.width + b.x - c) < b.width / duration / 25 + 1) tapped++
			}
		}
		console.log(device, name, 'bar', b.width + 'x' + b.height, 'circles', centres.length, 'free on the middle line', (line / n * 100).toFixed(0) + '%', 'free area', (free / n / b.height * 100).toFixed(0) + '%', `drags from a circle on their Frame ${exact}/${centres.length}, opened ${opened}`, `taps over a circle that seek ${tapped}/${options.hasTouch ? centres.length : 0}`)
	}
	await context.close()
}
await browser.close()
await api.delete(`/ocs/v2.php/apps/deliver/api/v1/projects/${project}?format=json`)
await api.dispose()
