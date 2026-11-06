<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * The Captions of a Version (#54): one SRT or WebVTT file per language,
 * stored as UTF-8 in app data, a folder per Version apart from its derived
 * media, so that regenerating or rewriting the file keeps them; they go with
 * the Version. The browser converts SRT to WebVTT for the player.
 */
class Captions {
	public const MAX_BYTES = 1024 * 1024;
	private const FORMATS = ['srt', 'vtt'];
	/** One timing line of a cue, SRT or WebVTT: `00:00:01,000 --> 00:00:02,500`, hours optional */
	private const TIMING = '/^[ \t]*(?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3}[ \t]*-->[ \t]*(?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3}/m';

	public function __construct(
		private IAppDataFactory $appDataFactory,
	) {
	}

	/** @return list<string> the languages a Version has Captions in, as BCP 47 tags */
	public function languages(int $versionId): array {
		try {
			$names = array_map(static fn (ISimpleFile $file) => pathinfo($file->getName(), PATHINFO_FILENAME), $this->folder($versionId, false)->getDirectoryListing());
		} catch (NotFoundException) {
			return [];
		}
		sort($names);
		return $names;
	}

	/**
	 * Stores the Captions of one language, replacing what the Version had in it
	 *
	 * @throws InvalidRequestException no language tag, too large, or not a single cue in it
	 */
	public function store(int $versionId, string $language, string $bytes): void {
		if (!self::isLanguage($language)) {
			throw new InvalidRequestException('The language is no language tag such as de or pt-BR');
		}
		if (strlen($bytes) > self::MAX_BYTES) {
			throw new InvalidRequestException('A captions file has at most 1 MB');
		}
		$text = self::text($bytes);
		if (preg_match(self::TIMING, $text) !== 1) {
			throw new InvalidRequestException('Not a single cue could be read from the file: it is no SRT or WebVTT');
		}
		$format = preg_match('/^WEBVTT(?=$|\s)/', $text) === 1 ? 'vtt' : 'srt';
		$this->remove($versionId, $language);
		$this->folder($versionId, true)->newFile($language . '.' . $format, $text);
	}

	/** Deletes the Captions of one language; none there is fine */
	public function remove(int $versionId, string $language): void {
		if (!self::isLanguage($language)) {
			throw new InvalidRequestException('The language is no language tag such as de or pt-BR');
		}
		foreach (self::FORMATS as $format) {
			try {
				$this->folder($versionId, false)->getFile($language . '.' . $format)->delete();
			} catch (NotFoundException) {
			}
		}
	}

	/** @throws NotFoundException the Version has no Captions in that language */
	public function file(int $versionId, string $language): ISimpleFile {
		if (!self::isLanguage($language)) {
			throw new NotFoundException('No language tag');
		}
		$folder = $this->folder($versionId, false);
		foreach (self::FORMATS as $format) {
			if ($folder->fileExists($language . '.' . $format)) {
				return $folder->getFile($language . '.' . $format);
			}
		}
		throw new NotFoundException('No captions in ' . $language);
	}

	/** Deletes every Captions file of a Version, with the Version */
	public function forget(int $versionId): void {
		try {
			$this->folder($versionId, false)->delete();
		} catch (NotFoundException) {
		}
	}

	/** The file as UTF-8 without a byte order mark: UTF-8 where it is valid UTF-8, else Windows-1252 */
	public static function text(string $bytes): string {
		if (str_starts_with($bytes, "\xEF\xBB\xBF")) {
			$bytes = substr($bytes, 3);
		}
		return mb_check_encoding($bytes, 'UTF-8') ? $bytes : (string)mb_convert_encoding($bytes, 'UTF-8', 'Windows-1252');
	}

	/** A BCP 47 tag as the browser writes it, such as de or pt-BR; it names the file */
	private static function isLanguage(string $language): bool {
		return preg_match('/^[a-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/', $language) === 1;
	}

	/** @throws NotFoundException no folder, and none wanted */
	private function folder(int $versionId, bool $create): ISimpleFolder {
		$appData = $this->appDataFactory->get(Application::APP_ID);
		$name = 'captions-' . $versionId;
		try {
			return $appData->getFolder($name);
		} catch (NotFoundException $e) {
			return $create ? $appData->newFolder($name) : throw $e;
		}
	}
}
