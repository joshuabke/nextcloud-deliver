import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserEnv, chunkPlan, current, etagOf, goesOn, HEARTBEAT, parseChunks, sameFile, sentElsewhere, uploadFile } from './upload.js'

/**
 * Nextcloud's WebDAV, as far as an upload sees it: files by URL, upload
 * folders with numbered chunks, and a MOVE of .file that joins them.
 *
 * @param {{failChunk?: number, offlineOnce?: boolean, lostMove?: boolean, lostPut?: boolean}} trouble - what goes wrong once
 */
function fakeDav(trouble = {}) {
	const files = new Map()
	const folders = new Map()
	const log = []
	let browserOnline = true
	const fail = (status) => Promise.reject(Object.assign(new Error(String(status)), status ? { response: { status } } : {}))
	const request = async ({ method, url, data, headers, onUploadProgress }) => {
		log.push(`${method} ${url.replace(/^.*\/(uploads|files)\//, '')}`)
		if (method === 'HEAD') {
			return files.has(url) ? { headers: {} } : fail(404)
		}
		if (method === 'MKCOL') {
			folders.set(url, new Map())
			return { headers: {} }
		}
		if (method === 'PROPFIND') {
			if (files.has(url)) {
				return { data: '<d:multistatus><d:response><d:propstat><d:prop><oc:fileid>43</oc:fileid></d:prop></d:propstat></d:response></d:multistatus>' }
			}
			const chunks = folders.get(url)
			return chunks
				? { data: `<d:multistatus>${[...chunks].map(([n, blob]) => `<d:response><d:href>${url}/${n}</d:href><d:propstat><d:prop><d:getcontentlength>${blob.size}</d:getcontentlength></d:prop></d:propstat></d:response>`).join('')}</d:multistatus>` }
				: fail(404)
		}
		if (method === 'PUT') {
			const folder = url.slice(0, url.lastIndexOf('/'))
			const number = Number(url.slice(url.lastIndexOf('/') + 1))
			if (trouble.offlineOnce && number === 2) {
				trouble.offlineOnce = false
				browserOnline = false
				return fail(undefined)
			}
			if (trouble.failChunk === number) {
				delete trouble.failChunk
				return fail(503)
			}
			onUploadProgress?.({ loaded: data.size })
			if (folders.has(folder)) {
				folders.get(folder).set(number, data)
				return { headers: {} }
			}
			if (headers['If-None-Match'] === '*' && files.has(url)) {
				return fail(412)
			}
			files.set(url, data)
			if (trouble.lostPut) {
				delete trouble.lostPut
				return fail(undefined)
			}
			return { headers: { 'oc-fileid': '00000042ocabc', etag: '"5f3e"' } }
		}
		if (method === 'MOVE') {
			const folder = url.replace(/\/\.file$/, '')
			if (headers.Overwrite === 'F' && files.has(headers.Destination)) {
				return fail(412)
			}
			const chunks = [...folders.get(folder)].sort(([a], [b]) => a - b).map(([, blob]) => blob)
			folders.delete(folder)
			files.set(headers.Destination, new Blob(chunks))
			if (trouble.lostMove) {
				// A proxy gives up while the server joins the chunks, and the answer never comes
				delete trouble.lostMove
				return fail(524)
			}
			return { headers: { 'oc-fileid': '00000043ocabc', 'oc-etag': 'W/"7a1c"' } }
		}
		return fail(405)
	}
	const env = {
		online: () => browserOnline,
		untilOnline: async () => {
			browserOnline = true
		},
		sleep: async () => {},
	}
	return { files, folders, log, request, env }
}

const TARGET = 'https://cloud/remote.php/dav/files/ana/Cut/cut.mov'
const UPLOADS = 'https://cloud/remote.php/dav/uploads/ana'
const file = (size) => new File([new Uint8Array(size).map((_, i) => i % 251)], 'cut.mov', { lastModified: 1000 })
const bytes = async (blob) => [...new Uint8Array(await blob.arrayBuffer())]

describe('chunks', () => {
	it('numbers them from 1 and keeps the last one short', () => {
		expect(chunkPlan(25, 10)).toEqual([{ number: 1, start: 0, end: 10 }, { number: 2, start: 10, end: 20 }, { number: 3, start: 20, end: 25 }])
	})

	it('reads which chunks the server has from its answer', () => {
		const xml = '<d:multistatus><d:response><d:href>/remote.php/dav/uploads/ana/x/</d:href></d:response><d:response><d:href>/remote.php/dav/uploads/ana/x/2</d:href><d:propstat><d:prop><d:getcontentlength>10</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>'
		expect(parseChunks(xml)).toEqual(new Map([[2, 10]]))
	})

	it('knows the same file again by name, size and modification time', () => {
		expect(sameFile({ name: 'cut.mov', size: 25, lastModified: 1000 }, file(25))).toBe(true)
		expect(sameFile({ name: 'cut.mov', size: 24, lastModified: 1000 }, file(25))).toBe(false)
	})

	it('goes on with it in its folder and on its Version Stack only, also under the name its upload took there', () => {
		const stopped = { status: 'interrupted', name: 'cut.mov', size: 25, lastModified: 1000, assetId: 7, target: `${UPLOADS}/Cut/cut_v2.mov` }
		expect(goesOn(stopped, `${UPLOADS}/Cut`, 7, file(25))).toBe(true)
		expect(goesOn(stopped, `${UPLOADS}/Cut/sub`, 7, file(25))).toBe(false)
		expect(goesOn(stopped, `${UPLOADS}/Cut`, 8, file(25))).toBe(false)
		expect(goesOn(stopped, `${UPLOADS}/Cut`, null, file(25))).toBe(false)
		expect(goesOn({ ...stopped, assetId: null }, `${UPLOADS}/Cut`, null, file(25))).toBe(true)
		expect(goesOn({ ...stopped, status: 'uploading' }, `${UPLOADS}/Cut`, 7, file(25))).toBe(false)
	})
})

describe('records of unfinished uploads', () => {
	const now = Date.UTC(2026, 9, 20)

	it('are offered for a day, as long as the server keeps the chunks', () => {
		expect(current({ seen: now - 23 * 3600 * 1000 }, now)).toBe(true)
		expect(current({ seen: now - 25 * 3600 * 1000 }, now)).toBe(false)
	})

	it('belong to the tab that still sends them, until it stops touching them or leaves', () => {
		expect(sentElsewhere({ seen: now - HEARTBEAT }, now)).toBe(true)
		expect(sentElsewhere({ seen: now - HEARTBEAT, left: true }, now)).toBe(false)
		expect(sentElsewhere({ seen: now - 4 * HEARTBEAT }, now)).toBe(false)
	})
})

describe('an upload', () => {
	it('sends a small file in one piece', async () => {
		const dav = fakeDav()
		expect(await uploadFile({ request: dav.request, file: file(5), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).toBe(42)
		expect(dav.log).toEqual(['HEAD ana/Cut/cut.mov', 'PUT ana/Cut/cut.mov'])
	})

	it('joins a large file from chunks, byte for byte', async () => {
		const dav = fakeDav()
		const progress = []
		const id = await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onProgress: (n) => progress.push(n), env: dav.env })
		expect(id).toBe(43)
		expect(await bytes(dav.files.get(TARGET))).toEqual(await bytes(file(25)))
		expect(progress.at(-1)).toBe(25)
		expect(dav.folders.size).toBe(0)
	})

	it('names the ETag of the content the server took, for what is measured of it', async () => {
		const etags = []
		await uploadFile({ request: fakeDav().request, file: file(5), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onEtag: (etag) => etags.push(etag), env: fakeDav().env })
		const dav = fakeDav()
		await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onEtag: (etag) => etags.push(etag), env: dav.env })
		expect(etags).toEqual(['5f3e', '7a1c'])
	})

	it('names no ETag where the last answer was lost', async () => {
		const dav = fakeDav({ lostMove: true })
		const etags = []
		await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onEtag: (etag) => etags.push(etag), env: dav.env })
		expect(etags).toEqual([])
		expect(etagOf({ headers: {} })).toBeNull()
	})

	it('refuses a name that is taken, before uploading anything', async () => {
		const dav = fakeDav()
		dav.files.set(TARGET, new Blob(['old']))
		await expect(uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).rejects.toMatchObject({ response: { status: 412 } })
		expect(dav.log).toEqual(['HEAD ana/Cut/cut.mov'])
	})

	it('sends a chunk again after a server error and waits out a lost network', async () => {
		const dav = fakeDav({ failChunk: 1, offlineOnce: true })
		const paused = []
		await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: { ...dav.env, onPause: (p) => paused.push(p) } })
		expect(await bytes(dav.files.get(TARGET))).toEqual(await bytes(file(25)))
		expect(paused).toEqual([true, false])
	})

	it('finds the file that arrived when the answer to its last step was lost', async () => {
		const dav = fakeDav({ lostMove: true })
		expect(await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).toBe(43)
		expect(dav.log.filter((line) => line.startsWith('MOVE'))).toHaveLength(1)
	})

	it('fails when another file took the name while it uploaded, rather than taking that file for its own', async () => {
		const dav = fakeDav()
		const racing = (config) => {
			if (config.method === 'MOVE') {
				dav.files.set(TARGET, new Blob(['someone else']))
			}
			return dav.request(config)
		}
		await expect(uploadFile({ request: racing, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).rejects.toMatchObject({ response: { status: 412 } })
	})

	// The names a new Version may take, as the store gives them
	const numbered = () => {
		let number = 1
		return async () => TARGET.replace('cut.mov', `cut_v${++number}.mov`)
	}

	it('takes the first free name instead of a taken one, where it may, and leaves the others alone', async () => {
		const dav = fakeDav()
		dav.files.set(TARGET, new Blob(['old'])).set(TARGET.replace('cut', 'cut_v2'), new Blob(['older']))
		expect(await uploadFile({ request: dav.request, file: file(5), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).toBe(42)
		expect(dav.log).toEqual(['HEAD ana/Cut/cut.mov', 'HEAD ana/Cut/cut_v2.mov', 'HEAD ana/Cut/cut_v3.mov', 'PUT ana/Cut/cut_v3.mov'])
		expect([...dav.files.values()].map((blob) => blob.size)).toEqual([3, 5, 5])
	})

	it('gives up where every name is taken, as a server answering anything with a page does', async () => {
		let heads = 0
		const always = async () => {
			if (++heads > 1000) {
				throw new Error('never ends')
			}
			return { headers: {} }
		}
		await expect(uploadFile({ request: always, file: file(5), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, env: fakeDav().env })).rejects.toMatchObject({ response: { status: 412 } })
		expect(heads).toBeLessThan(200)
	})

	it('moves the chunks it sent to the next free name when another file took its own meanwhile', async () => {
		const dav = fakeDav()
		let raced = false
		const racing = (config) => {
			if (config.method === 'MOVE' && !raced) {
				raced = true
				dav.files.set(TARGET, new Blob(['someone else']))
			}
			return dav.request(config)
		}
		expect(await uploadFile({ request: racing, file: file(25), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).toBe(43)
		expect(dav.log.filter((line) => line.startsWith('PUT'))).toHaveLength(3)
		expect(await dav.files.get(TARGET).text()).toBe('someone else')
		expect(await bytes(dav.files.get(TARGET.replace('cut', 'cut_v2')))).toEqual(await bytes(file(25)))
	})

	it('sends a small file again under the next free name when another file took its own meanwhile', async () => {
		const dav = fakeDav()
		let raced = false
		const racing = (config) => {
			if (config.method === 'PUT' && !raced) {
				raced = true
				dav.files.set(TARGET, new Blob(['someone else']))
			}
			return dav.request(config)
		}
		await uploadFile({ request: racing, file: file(5), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })
		expect(dav.files.get(TARGET.replace('cut', 'cut_v2')).size).toBe(5)
		expect(await dav.files.get(TARGET).text()).toBe('someone else')
	})

	it('refuses a name taken after a lost answer, neither adopting a file of the same size nor sending its own twice', async () => {
		// Its own file, which arrived though the answer did not, and another one of the same size that came meanwhile
		for (const theirs of [null, new File(['other'], 'cut.mov')]) {
			const dav = fakeDav({ lostPut: true })
			const meanwhile = (config) => dav.request(config).finally(() => {
				if (theirs && config.method === 'PUT') {
					dav.files.set(TARGET, theirs)
				}
			})
			await expect(uploadFile({ request: meanwhile, file: file(5), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env })).rejects.toMatchObject({ response: { status: 412 } })
			expect([...dav.files.keys()]).toEqual([TARGET])
		}
	})

	it('refuses a taken name when its chunk folder is gone, neither adopting a file of the same size nor sending its own twice', async () => {
		const dav = fakeDav()
		dav.files.set(TARGET, new Blob([new Uint8Array(25)]))
		await expect(uploadFile({ request: dav.request, file: file(25), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, folder: `${UPLOADS}/deliver-gone`, env: dav.env })).rejects.toMatchObject({ response: { status: 412 } })
		expect(dav.log.filter((line) => /^(PUT|MOVE)/.test(line))).toEqual([])
	})

	it('keeps going under the next name with the chunks the server has, after a reload', async () => {
		const dav = fakeDav()
		const folder = `${UPLOADS}/deliver-x`
		dav.folders.set(folder, new Map([[1, file(25).slice(0, 10)], [2, file(25).slice(10, 20)]]))
		dav.files.set(TARGET, new Blob(['old']))
		expect(await uploadFile({ request: dav.request, file: file(25), target: TARGET, onTaken: numbered(), uploadsUrl: UPLOADS, chunkSize: 10, folder, env: dav.env })).toBe(43)
		expect(dav.log.filter((line) => line.startsWith('PUT'))).toEqual(['PUT ana/deliver-x/3'])
		expect(await bytes(dav.files.get(TARGET.replace('cut', 'cut_v2')))).toEqual(await bytes(file(25)))
	})

	it('says where a taken name may be this very upload, whose answer was lost or whose chunk folder is gone', async () => {
		const refused = async (dav, options = {}) => uploadFile({ request: dav.request, file: file(5), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env: dav.env, ...options }).catch((error) => [error.response?.status, Boolean(error.unsure)])
		expect(await refused(fakeDav({ lostPut: true }))).toEqual([412, true])
		const taken = fakeDav()
		taken.files.set(TARGET, new Blob(['old']))
		expect(await refused(taken)).toEqual([412, false])
		expect(await refused(taken, { file: file(25), folder: `${UPLOADS}/deliver-gone` })).toEqual([412, true])
		// Every attempt lost: whether it arrived is not known either
		expect(await refused(fakeDav(), { request: ({ method }) => Promise.reject(Object.assign(new Error('lost'), method === 'HEAD' ? { response: { status: 404 } } : {})) })).toEqual([undefined, true])
	})

	it('joins the chunks under another name once it is renamed, and sends none again', async () => {
		const dav = fakeDav()
		let folder = null
		const racing = (config) => {
			if (config.method === 'MOVE') {
				dav.files.set(TARGET, new Blob(['someone else']))
			}
			return dav.request(config)
		}
		await expect(uploadFile({ request: racing, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onFolder: (f) => (folder = f), env: dav.env })).rejects.toMatchObject({ response: { status: 412 } })
		dav.log.length = 0
		const renamed = TARGET.replace('cut', 'cut (2)')
		expect(await uploadFile({ request: dav.request, file: file(25), target: renamed, uploadsUrl: UPLOADS, chunkSize: 10, folder, env: dav.env })).toBe(43)
		expect(dav.log.map((line) => line.split(' ')[0])).toEqual(['PROPFIND', 'HEAD', 'MOVE'])
		expect(await bytes(dav.files.get(renamed))).toEqual(await bytes(file(25)))
	})

	it('stops waiting for the network when it is cancelled', async () => {
		const dav = fakeDav({ offlineOnce: true })
		const controller = new AbortController()
		const paused = []
		const env = { ...dav.env, signal: controller.signal, untilOnline: async () => controller.abort(), onPause: (p) => paused.push(p) }
		await expect(uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, env })).rejects.toThrow()
		expect(paused).toEqual([true])
	})

	it('goes on from the chunks the server kept, after a reload', async () => {
		const dav = fakeDav()
		let folder = null
		// The first try stops for good after its first chunk
		const stopping = (config) => config.method === 'PUT' && config.url.endsWith('/2') ? Promise.reject(Object.assign(new Error('gone'), { response: { status: 400 } })) : dav.request(config)
		await expect(uploadFile({ request: stopping, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, onFolder: (f) => (folder = f), env: dav.env })).rejects.toThrow()
		dav.log.length = 0
		await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, folder, env: dav.env })
		expect(dav.log.filter((line) => line.startsWith('PUT')).map((line) => line.slice(-1))).toEqual(['2', '3'])
		expect(await bytes(dav.files.get(TARGET))).toEqual(await bytes(file(25)))
	})

	it('starts over when the server dropped the chunks', async () => {
		const dav = fakeDav()
		await uploadFile({ request: dav.request, file: file(25), target: TARGET, uploadsUrl: UPLOADS, chunkSize: 10, folder: `${UPLOADS}/deliver-gone`, env: dav.env })
		expect(dav.log.filter((line) => line.startsWith('PUT'))).toHaveLength(3)
	})
})

describe('browserEnv', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('ends the waiting for the network and the pause between attempts on an abort', async () => {
		vi.stubGlobal('window', { addEventListener: () => {} })
		const controller = new AbortController()
		const env = browserEnv(controller.signal)
		const waiting = Promise.all([env.untilOnline(), env.sleep(3600)])
		controller.abort()
		await waiting
	})
})
