<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * The filename convention behind automatic stacking: `cut_v3.mp4` is Version 3
 * of `cut`. Separator and zero padding are optional and case does not matter
 * (spec: Discovery and stacking). Only a newly arrived file is stacked by its
 * name; renaming a file later never regroups anything.
 */
final class VersionNaming {
	private const PATTERN = '/^(?<base>.*?)[ _-]?v(?<number>\d{1,4})$/i';

	/**
	 * @return array{base: string, number: int}|null the Asset name and Version
	 *                                               Number a filename suggests
	 */
	public static function parse(string $filename): ?array {
		$stem = pathinfo($filename, PATHINFO_FILENAME);
		if (preg_match(self::PATTERN, $stem, $match) !== 1) {
			return null;
		}
		$base = rtrim($match['base']);
		$number = (int)$match['number'];
		if ($base === '' || $number < 1) {
			return null;
		}
		return ['base' => $base, 'number' => $number];
	}

	/** The Asset name a file falls back to when it follows no convention */
	public static function assetName(string $filename): string {
		return self::parse($filename)['base'] ?? pathinfo($filename, PATHINFO_FILENAME);
	}
}
