<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\VersionNaming;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** The filename convention, on its own: no Nextcloud, no database */
class VersionNamingTest extends TestCase {
	public static function conventions(): array {
		return [
			'underscore' => ['cut_v3.mp4', 'cut', 3],
			'dash and padding' => ['cut-v03.mov', 'cut', 3],
			'space' => ['final cut v12.mp4', 'final cut', 12],
			'no separator' => ['cutV7.mxf', 'cut', 7],
			'upper case' => ['CUT_V2.MP4', 'CUT', 2],
			'name that ends in a word' => ['interview_anna_v2.mp4', 'interview_anna', 2],
			'dots in the name' => ['cut.final_v4.mp4', 'cut.final', 4],
		];
	}

	#[DataProvider('conventions')]
	public function testFilenamesThatCarryAVersionNumber(string $filename, string $base, int $number): void {
		self::assertSame(['base' => $base, 'number' => $number], VersionNaming::parse($filename));
	}

	public static function plainNames(): array {
		return [
			'no suffix' => ['cut.mp4'],
			'version zero' => ['cut_v0.mp4'],
			'nothing but a version' => ['v3.mp4'],
			'letters after the number' => ['cut_v3b.mp4'],
			'too many digits' => ['cut_v12345.mp4'],
			'a year, not a Version' => ['cut_2026.mp4'],
		];
	}

	#[DataProvider('plainNames')]
	public function testFilenamesThatSuggestNothing(string $filename): void {
		self::assertNull(VersionNaming::parse($filename), $filename);
	}

	public function testAssetNameFallsBackToTheStem(): void {
		self::assertSame('cut', VersionNaming::assetName('cut_v3.mp4'));
		self::assertSame('cut', VersionNaming::assetName('cut.mp4'));
		self::assertSame('holiday.2026', VersionNaming::assetName('holiday.2026.mov'));
	}
}
