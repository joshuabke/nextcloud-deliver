import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media')
const ROOT = join(FIXTURES, '..', '..', '..')
/** WebM, because open-source Chromium builds carry no H.264 decoder */
export const CLIP = join(FIXTURES, 'clip-25fps.webm')

/** A Scrub Proxy of CLIP as ffmpeg makes it, for a server without ffmpeg to take one through the API (#169) */
export const CLIP_SCRUB = join(FIXTURES, 'clip-25fps-scrub.mp4')

/** A WAV, which plays as it is, so it goes up without ffmpeg too */
export const MIX = join(FIXTURES, 'mix.wav')
/** DNxHR in MOV: no browser decodes it, so without ffmpeg it is refused before it goes up (ADR 0019) */
export const DNXHR = join(FIXTURES, 'master-dnxhr.mov')
/** A Proxy of it as an editor renders it, with its Frames (ADR 0020) */
export const HAND_PROXY = join(FIXTURES, 'master-dnxhr-proxy.mp4')

/**
 * Generates the media the browser tests play; committed fixtures would be binary noise.
 * The ffmpeg of the dev container makes them, in the app folder it mounts, so no
 * machine running the tests needs one of its own.
 */
export default function globalSetup() {
	mkdirSync(FIXTURES, { recursive: true })
	const make = (file, args) => existsSync(file) || execFileSync('docker', [
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
		...args,
		relative(ROOT, file),
	], { cwd: ROOT, stdio: 'inherit' })
	make(CLIP, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-c:v', 'libvpx-vp9', '-b:v', '200k'])
	make(CLIP_SCRUB, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '200k', '-g', '25', '-f', 'mp4'])
	make(MIX, ['-f', 'lavfi', '-i', 'sine=duration=1', '-f', 'wav'])
	make(DNXHR, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p', '-f', 'mov'])
	make(HAND_PROXY, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mp4'])
}
