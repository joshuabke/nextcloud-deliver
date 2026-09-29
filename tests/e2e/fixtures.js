import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media')
/** WebM, because open-source Chromium builds carry no H.264 decoder */
export const CLIP = join(FIXTURES, 'clip-25fps.webm')

/** Generates the media the browser tests play; committed fixtures would be binary noise */
export default function globalSetup() {
	if (existsSync(CLIP)) {
		return
	}
	mkdirSync(FIXTURES, { recursive: true })
	execFileSync('ffmpeg', [
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
		CLIP,
	])
}
