import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media')
const ROOT = join(FIXTURES, '..', '..', '..')
/** WebM, because open-source Chromium builds carry no H.264 decoder */
export const CLIP = join(FIXTURES, 'clip-25fps.webm')

/**
 * Generates the media the browser tests play; committed fixtures would be binary noise.
 * The ffmpeg of the dev container makes them, in the app folder it mounts, so no
 * machine running the tests needs one of its own.
 */
export default function globalSetup() {
	if (existsSync(CLIP)) {
		return
	}
	mkdirSync(FIXTURES, { recursive: true })
	execFileSync('docker', [
		'compose',
		'exec',
		'-T',
		'-u',
		String(process.getuid()),
		'-w',
		'/var/www/html/custom_apps/deliver',
		'nextcloud',
		'ffmpeg',
		'-loglevel',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		'testsrc=size=320x180:rate=25:duration=4',
		'-c:v',
		'libvpx-vp9',
		'-b:v',
		'200k',
		relative(ROOT, CLIP),
	], { cwd: ROOT, stdio: 'inherit' })
}
