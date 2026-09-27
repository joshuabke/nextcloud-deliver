<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\Annotation;
use OCA\Deliver\Service\InvalidRequestException;
use PHPUnit\Framework\TestCase;

class AnnotationTest extends TestCase {
	public function testKeepsShapesInsideThePicture(): void {
		$json = Annotation::encode([
			['tool' => 'pen', 'color' => '#FF0000', 'points' => [[0.1, 0.2], [0.123456, 1.5]]],
			['tool' => 'box', 'color' => '#00ff00', 'points' => [[-1, 0], [0.5, 0.5]]],
		]);
		self::assertSame([
			['tool' => 'pen', 'color' => '#ff0000', 'points' => [[0.1, 0.2], [0.1235, 1]]],
			['tool' => 'box', 'color' => '#00ff00', 'points' => [[0, 0], [0.5, 0.5]]],
		], Annotation::decode($json));
		self::assertNull(Annotation::encode([]));
		self::assertNull(Annotation::encode(null));
	}

	/** @return iterable<string, array{mixed}> */
	public static function broken(): iterable {
		yield 'no list' => ['a drawing'];
		yield 'unknown tool' => [[['tool' => 'spray', 'color' => '#ff0000', 'points' => [[0, 0]]]]];
		yield 'no colour' => [[['tool' => 'pen', 'color' => 'red', 'points' => [[0, 0]]]]];
		yield 'arrow with three points' => [[['tool' => 'arrow', 'color' => '#ff0000', 'points' => [[0, 0], [1, 1], [0, 1]]]]];
		yield 'point without y' => [[['tool' => 'pen', 'color' => '#ff0000', 'points' => [[0]]]]];
		yield 'too many points' => [[['tool' => 'pen', 'color' => '#ff0000', 'points' => array_fill(0, 5001, [0, 0])]]];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('broken')]
	public function testRefusesWhatItCannotShow(mixed $shapes): void {
		$this->expectException(InvalidRequestException::class);
		Annotation::encode($shapes);
	}
}
