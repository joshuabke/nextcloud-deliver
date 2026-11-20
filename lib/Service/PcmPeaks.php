<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * The peaks of interleaved 16-bit PCM as it streams out of ffmpeg, a share
 * of a second at a time, so only the peaks stay in memory (ADR 0021): each
 * the loudest sample over all channels of its share, as a byte (peakByte).
 */
final class PcmPeaks {
	private string $pending = '';
	private string $peaks = '';

	public function __construct(
		private int $sampleRate,
		private int $channels,
		private int $rate,
	) {
	}

	/** @return bool false once the Waveform has the most peaks it may have: more sound than its header said is left out, and the caller stops */
	public function add(string $pcm): bool {
		if ($this->full()) {
			$this->pending = '';
			return false;
		}
		$this->pending .= $pcm;
		$offset = 0;
		while (!$this->full() && strlen($this->pending) - $offset >= ($share = $this->share())) {
			$this->peaks .= self::loudest(substr($this->pending, $offset, $share));
			$offset += $share;
		}
		// Less than a share stays, or nothing once full
		$this->pending = $this->full() ? '' : substr($this->pending, $offset);
		return !$this->full();
	}

	private function full(): bool {
		return strlen($this->peaks) >= DerivedMedia::WAVEFORM_MAX_PEAKS;
	}

	/** @return string the peaks, the last share as long as the sound */
	public function peaks(): string {
		return strlen($this->pending) >= 2 ? $this->peaks . self::loudest($this->pending) : $this->peaks;
	}

	/** The bytes of the next peak's share: whole samples of every channel, with no drift for a rate that does not divide the sample rate */
	private function share(): int {
		$i = strlen($this->peaks);
		return 2 * $this->channels * (intdiv(($i + 1) * $this->sampleRate, $this->rate) - intdiv($i * $this->sampleRate, $this->rate));
	}

	private static function loudest(string $pcm): string {
		$samples = unpack('s*', $pcm) ?: [0];
		return DerivedMedia::peakByte(max(max($samples), -min($samples)) / 32767);
	}
}
