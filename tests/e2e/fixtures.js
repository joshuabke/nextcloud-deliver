import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media')
const ROOT = join(FIXTURES, '..', '..', '..')
/** WebM, because open-source Chromium builds carry no H.264 decoder */
export const CLIP = join(FIXTURES, 'clip-25fps.webm')

/** Long enough to skip ten seconds twice inside it */
export const LONG = join(FIXTURES, 'long-25fps.webm')

/** A Scrub Proxy of CLIP as ffmpeg makes it, for a server without ffmpeg to take one through the API (#169) */
export const CLIP_SCRUB = join(FIXTURES, 'clip-25fps-scrub.mp4')

/** A WAV, which plays as it is, so it goes up without ffmpeg too */
export const MIX = join(FIXTURES, 'mix.wav')
/** Six minutes of Opus, mono and low: long enough for the scrolling Waveform to zoom and scroll (story 180), yet tiny */
export const LONG_MIX = join(FIXTURES, 'long-mix.webm')
/** Two Versions of a mix to compare by ear (A2): 330 Hz swelling every 5 s against a softer 660 Hz swelling every 3 s */
export const MIX_A = join(FIXTURES, 'compare-mix-a.webm')
export const MIX_B = join(FIXTURES, 'compare-mix-b.webm')
/** Two cuts with different soundtracks, 440 Hz and 880 Hz */
export const CUT_A = join(FIXTURES, 'compare-cut-a.webm')
export const CUT_B = join(FIXTURES, 'compare-cut-b.webm')
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
	make(LONG, ['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=25:duration=30', '-c:v', 'libvpx-vp9', '-b:v', '50k'])
	make(CLIP_SCRUB, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '200k', '-g', '25', '-f', 'mp4'])
	make(MIX, ['-f', 'lavfi', '-i', 'sine=duration=1', '-f', 'wav'])
	make(LONG_MIX, ['-f', 'lavfi', '-i', "aevalsrc=exprs='sin(2*PI*220*t)*(0.1+0.9*abs(sin(2*PI*t/7)))':s=8000:d=360", '-c:a', 'libopus', '-b:a', '6k', '-f', 'webm'])
	make(MIX_A, ['-f', 'lavfi', '-i', "aevalsrc=exprs='sin(2*PI*330*t)*(0.2+0.8*abs(sin(2*PI*t/10)))':s=16000:d=20", '-c:a', 'libopus', '-b:a', '12k', '-f', 'webm'])
	make(MIX_B, ['-f', 'lavfi', '-i', "aevalsrc=exprs='0.5*sin(2*PI*660*t)*(0.1+0.9*abs(sin(2*PI*t/6)))':s=16000:d=20", '-c:a', 'libopus', '-b:a', '12k', '-f', 'webm'])
	for (const [file, pitch, pattern] of [[CUT_A, 440, 'testsrc'], [CUT_B, 880, 'testsrc2']]) {
		make(file, ['-f', 'lavfi', '-i', `${pattern}=size=160x90:rate=25:duration=4`, '-f', 'lavfi', '-i', `sine=frequency=${pitch}:duration=4`, '-c:v', 'libvpx-vp9', '-b:v', '50k', '-c:a', 'libopus', '-b:a', '16k', '-f', 'webm'])
	}
	make(DNXHR, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p', '-f', 'mov'])
	make(HAND_PROXY, ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mp4'])
}
