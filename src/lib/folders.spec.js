import { describe, expect, it } from 'vitest'
import { filesDir, folderTree, groupByFolder, inFolder, projectDavPath, projectDir, uploadFolder } from './folders.js'

describe('folders', () => {
	it('groups Assets by folder, the Project folder first', () => {
		const groups = groupByFolder([{ path: 'b', id: 1 }, { path: '', id: 2 }, { path: 'a', id: 3 }, { path: 'b', id: 4 }])
		expect(groups.map((group) => [group.path, group.assets.map((asset) => asset.id)])).toEqual([['', [2]], ['a', [3]], ['b', [1, 4]]])
	})

	it('uploads next to the newest Version that still has a file', () => {
		expect(uploadFolder([{ url: null }, { url: 'http://x/remote.php/dav/files/me/Show/a.mov' }])).toBe('http://x/remote.php/dav/files/me/Show')
		expect(uploadFolder([{ url: null }])).toBeNull()
	})

	it('finds the Files folder of a WebDAV URL', () => {
		expect(filesDir('http://x/remote.php/dav/files/me/Synthese%20Quartet/Video/No.%204.mp4')).toBe('/Synthese Quartet/Video')
		expect(filesDir('http://x/remote.php/dav/files/me/a.mov')).toBe('/')
	})

	it('finds the Files folder of a Project', () => {
		expect(projectDir('/me/files/Clients/Showreel')).toBe('/Clients/Showreel')
		expect(projectDavPath('/me/files/Clients/Show reel')).toBe('me/Clients/Show%20reel')
	})

	it('lists the folders of a Project with the ones around them and counts what lies below', () => {
		const tree = folderTree([{ path: '' }, { path: 'Interviews/Raw' }, { path: 'Interviews' }, { path: 'B-Roll' }])
		expect(tree).toEqual([
			{ path: 'B-Roll', name: 'B-Roll', depth: 0, count: 1 },
			{ path: 'Interviews', name: 'Interviews', depth: 0, count: 2 },
			{ path: 'Interviews/Raw', name: 'Raw', depth: 1, count: 1 },
		])
	})

	it('keeps a folder\'s Assets and those below it', () => {
		expect([inFolder({ path: 'Interviews/Raw' }, 'Interviews'), inFolder({ path: 'Interviews 2' }, 'Interviews'), inFolder({ path: '' }, '')]).toEqual([true, false, true])
	})
})
