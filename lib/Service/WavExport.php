<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCP\Files\File;

/**
 * The audio of a Version as a WAV file with the Comments as embedded
 * markers, which Logic, Cubase, Nuendo and Sequoia read from the file itself.
 * Only the download is written, to a temporary file; the file in Files stays
 * untouched (ADR 0002).
 */
class WavExport {
	/** RIFF sizes are 32 bits */
	private const RIFF_LIMIT = 0xFFFFFFFF;

	public function __construct(
		private Ffmpeg $ffmpeg,
		private Probe $probe,
	) {
	}

	/**
	 * @return string path of a temporary WAV file; the caller deletes it
	 * @throws ProjectConflictException the file is unreadable, or not WAV and there is no ffmpeg
	 */
	public function render(File $file, array $clip, array $markers): string {
		$source = $this->probe->localPath($file);
		if ($source === null) {
			throw new ProjectConflictException('The file of this Version is not readable');
		}
		$wav = tempnam(sys_get_temp_dir(), 'deliver-wav-') ?: throw new \RuntimeException('No temporary file for the WAV export');
		if (self::isWav($source)) {
			// A copy keeps every chunk, the BWF position included
			copy($source, $wav);
		} else {
			$result = $this->ffmpeg->run($this->ffmpeg->ffmpeg(), [
				'-y', '-nostdin', '-v', 'error', '-i', $source,
				'-map', '0:a:0', '-c:a', 'pcm_s24le', '-f', 'wav', $wav,
			]);
			if ($result['code'] !== 0) {
				@unlink($wav);
				throw new ProjectConflictException('This audio could not be turned into WAV: ' . $this->ffmpeg->tail($result['stderr']));
			}
		}
		$this->appendMarkers($wav, $clip, $markers);
		return $wav;
	}

	private static function isWav(string $path): bool {
		$handle = fopen($path, 'rb');
		$header = (string)fread($handle, 12);
		fclose($handle);
		return str_starts_with($header, 'RIFF') && substr($header, 8, 4) === 'WAVE';
	}

	/**
	 * Appends the marker chunks and corrects the RIFF size.
	 * ponytail: plain RIFF only; an RF64 original over 4 GB is refused
	 */
	private function appendMarkers(string $wav, array $clip, array $markers): void {
		$chunks = DawMarkers::wavChunks($clip, $markers, self::sampleRate($wav));
		$handle = fopen($wav, 'r+b');
		fseek($handle, 0, SEEK_END);
		$size = ftell($handle);
		if ($size % 2 === 1) {
			fwrite($handle, "\0");
			$size++;
		}
		if ($size + strlen($chunks) - 8 > self::RIFF_LIMIT) {
			fclose($handle);
			@unlink($wav);
			throw new ProjectConflictException('The audio is too large for a WAV file with markers');
		}
		fwrite($handle, $chunks);
		fseek($handle, 4);
		fwrite($handle, pack('V', $size + strlen($chunks) - 8));
		fclose($handle);
	}

	/** Reads the sample rate from the `fmt ` chunk */
	private static function sampleRate(string $wav): int {
		$handle = fopen($wav, 'rb');
		fseek($handle, 12);
		while (($header = fread($handle, 8)) !== false && strlen($header) === 8) {
			['size' => $size] = unpack('Vsize', substr($header, 4));
			if (substr($header, 0, 4) === 'fmt ') {
				$rate = unpack('V', substr((string)fread($handle, 8), 4))[1];
				fclose($handle);
				return $rate;
			}
			fseek($handle, $size + $size % 2, SEEK_CUR);
		}
		fclose($handle);
		throw new ProjectConflictException('This WAV file has no format chunk');
	}
}
