import { describe, expect, it } from 'vitest'
import { folderTree, groupByFolder, inFolder, projectDavPath, projectDir, uploadFolder } from './folders.js'

describe('folders', () => {
	it('groups Assets by folder, the Project folder first', () => {
		const groups = groupByFolder([{ path: 'b', id: 1 }, { path: '', id: 2 }, { path: 'a', id: 3 }, { path: 'b', id: 4 }])
		expect(groups.map((group) => [group.path, group.assets.map((asset) => asset.id)])).toEqual([['', [2]], ['a', [3]], ['b', [1, 4]]])
	})

	it('uploads next to the newest Version that still has a file', () => {
		expect(uploadFolder([{ url: null }, { url: 'http://x/remote.php/dav/files/me/Show/a.mov' }])).toBe('http://x/remote.php/dav/files/me/Show')
		expect(uploadFolder([{ url: null }])).toBeNull()
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

	it('keeps the leading slash of folders outside a Project folder, which run from home (ADR 0009)', () => {
		const tree = folderTree([{ path: '/Clients/Acme' }, { path: 'Raw' }])
		expect(tree.map((folder) => [folder.path, folder.name, folder.depth])).toEqual([
			['/Clients', 'Clients', 0],
			['/Clients/Acme', 'Acme', 1],
			['Raw', 'Raw', 0],
		])
		expect(inFolder({ path: '/Clients/Acme' }, '/Clients')).toBe(true)
	})

	it('keeps a folder\'s Assets and those below it', () => {
		expect([inFolder({ path: 'Interviews/Raw' }, 'Interviews'), inFolder({ path: 'Interviews 2' }, 'Interviews'), inFolder({ path: '' }, '')]).toEqual([true, false, true])
	})
})
