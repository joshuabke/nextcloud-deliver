<?php

declare(strict_types=1);

namespace OCA\Deliver\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
use OCP\Files\File;
use OCP\Files\SimpleFS\ISimpleFile;

/**
 * A file with byte-range support, so the player can seek. Nextcloud's own
 * StreamResponse only sends whole files.
 *
 * @template-extends Response<Http::STATUS_*, array<string, mixed>>
 */
class RangeFileResponse extends Response implements ICallbackResponse {
	private const CHUNK = 512 * 1024;

	private int $offset = 0;
	private int $length;
	/** @var callable(): (resource|false) */
	private $open;

	/**
	 * @param callable(): (resource|false) $open opens the file for reading
	 * @param ?string $range the request's Range header
	 */
	public function __construct(callable $open, int $size, string $contentType, string $etag, ?string $range) {
		parent::__construct();
		$this->open = $open;
		$this->length = $size;
		$this->addHeader('Content-Type', $contentType);
		$this->addHeader('Accept-Ranges', 'bytes');
		// Revalidate every time: a regenerated Proxy keeps its URL but not its ETag
		$this->setETag($etag);
		$this->addHeader('Cache-Control', 'private, no-cache');

		$wanted = self::parseRange($range ?? '', $size);
		if ($wanted === false) {
			$this->setStatus(Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE);
			$this->addHeader('Content-Range', "bytes */$size");
			$this->length = 0;
			return;
		}
		if ($wanted !== null) {
			[$this->offset, $this->length] = $wanted;
			$last = $this->offset + $this->length - 1;
			$this->setStatus(Http::STATUS_PARTIAL_CONTENT);
			$this->addHeader('Content-Range', "bytes {$this->offset}-{$last}/{$size}");
		}
		$this->addHeader('Content-Length', (string)$this->length);
	}

	public static function ofSimpleFile(ISimpleFile $file, ?string $range): self {
		return new self(fn () => $file->read(), $file->getSize(), $file->getMimeType(), $file->getETag(), $range);
	}

	public static function ofFile(File $file, ?string $range): self {
		return new self(fn () => $file->fopen('rb'), (int)$file->getSize(), $file->getMimeType(), $file->getEtag(), $range);
	}

	/**
	 * A single range as `bytes=from-to`, `bytes=from-` or `bytes=-suffix`.
	 *
	 * @return array{0: int, 1: int}|false|null offset and length; false when the
	 *                                          range lies outside the file; null for no or an unsupported
	 *                                          Range header, which means the whole file (RFC 9110)
	 */
	public static function parseRange(string $range, int $size): array|false|null {
		if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m) !== 1 || $m[1] . $m[2] === '') {
			return null;
		}
		[, $from, $to] = $m;
		if ($from === '') {
			$length = min((int)$to, $size);
			return $length > 0 ? [$size - $length, $length] : false;
		}
		if ((int)$from >= $size || ($to !== '' && (int)$to < (int)$from)) {
			return false;
		}
		$end = $to === '' ? $size - 1 : min((int)$to, $size - 1);
		return [(int)$from, $end - (int)$from + 1];
	}

	public function callback(IOutput $output): void {
		if ($this->length === 0) {
			return;
		}
		$handle = ($this->open)();
		if (!is_resource($handle)) {
			$output->setHttpResponseCode(Http::STATUS_NOT_FOUND);
			return;
		}
		// Some storages cannot seek; read up to the offset instead
		if ($this->offset > 0 && fseek($handle, $this->offset) !== 0) {
			$skip = $this->offset;
			while ($skip > 0 && ($chunk = fread($handle, min(self::CHUNK, $skip))) !== false && $chunk !== '') {
				$skip -= strlen($chunk);
			}
		}
		$left = $this->length;
		while ($left > 0 && !feof($handle)) {
			$chunk = fread($handle, min(self::CHUNK, $left));
			if ($chunk === false || $chunk === '') {
				break;
			}
			$output->setOutput($chunk);
			$left -= strlen($chunk);
		}
		fclose($handle);
	}
}
