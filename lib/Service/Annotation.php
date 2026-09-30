<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * A drawing on a Frame (story 89): shapes in coordinates from 0 to 1 across
 * the picture, so it fits the picture at any size. Checked here, stored as
 * JSON with its Comment.
 */
final class Annotation {
	public const TOOLS = ['pen', 'arrow', 'box'];
	private const MAX_SHAPES = 100;
	private const MAX_POINTS = 5000;

	/**
	 * @param mixed $shapes as the client sends them
	 * @return ?string the JSON to store, null for no drawing
	 * @throws InvalidRequestException not a drawing Deliver can show
	 */
	public static function encode(mixed $shapes): ?string {
		if ($shapes === null || $shapes === []) {
			return null;
		}
		if (!is_array($shapes) || !array_is_list($shapes) || count($shapes) > self::MAX_SHAPES) {
			throw new InvalidRequestException('A drawing is a list of up to ' . self::MAX_SHAPES . ' shapes');
		}
		$points = 0;
		$clean = [];
		foreach ($shapes as $shape) {
			$tool = is_array($shape) ? ($shape['tool'] ?? null) : null;
			$color = is_array($shape) ? ($shape['color'] ?? null) : null;
			$list = is_array($shape) ? ($shape['points'] ?? null) : null;
			if (!in_array($tool, self::TOOLS, true) || !is_string($color) || preg_match('/^#[0-9a-f]{6}$/i', $color) !== 1 || !is_array($list) || !array_is_list($list) || $list === []) {
				throw new InvalidRequestException('A shape has a tool (pen, arrow, box), a colour like #ff0000 and points');
			}
			if ($tool !== 'pen' && count($list) !== 2) {
				throw new InvalidRequestException('An arrow or a box has two points');
			}
			$points += count($list);
			if ($points > self::MAX_POINTS) {
				throw new InvalidRequestException('A drawing has at most ' . self::MAX_POINTS . ' points');
			}
			$clean[] = [
				'tool' => $tool,
				'color' => strtolower($color),
				'points' => array_map(static function (mixed $point): array {
					if (!is_array($point) || count($point) !== 2 || !is_numeric($point[0] ?? null) || !is_numeric($point[1] ?? null)) {
						throw new InvalidRequestException('A point is [x, y]');
					}
					// Four decimals are a tenth of a pixel on a 4K picture
					return [round(min(1, max(0, (float)$point[0])), 4), round(min(1, max(0, (float)$point[1])), 4)];
				}, $list),
			];
		}
		return json_encode($clean, JSON_THROW_ON_ERROR);
	}

	/** @return ?list<array{tool: string, color: string, points: list<array{0: float, 1: float}>}> */
	public static function decode(?string $json): ?array {
		return $json === null ? null : json_decode($json, true);
	}
}
