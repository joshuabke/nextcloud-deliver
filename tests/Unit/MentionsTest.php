<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Service\Mentions;
use PHPUnit\Framework\TestCase;

class MentionsTest extends TestCase {
	public function testFindsMentionsOnceEach(): void {
		self::assertSame(['anna', 'ben.k', 'Jo Smith'], Mentions::parse('@anna look, @ben.k agreed. @"Jo Smith" and @anna again'));
		self::assertSame(['anna'], Mentions::parse('thanks @anna.'));
		self::assertSame([], Mentions::parse('mail me at jo@example.com'));
	}

	public function testRendersDisplayNamesAndLeavesStrangersAlone(): void {
		self::assertSame(
			'@Anna Berg look, thanks @Jo Smith. @nobody',
			Mentions::render('@anna look, thanks @"Jo Smith". @nobody', ['anna' => 'Anna Berg', 'Jo Smith' => 'Jo Smith']),
		);
		self::assertSame('thanks @Anna Berg.', Mentions::render('thanks @anna.', ['anna' => 'Anna Berg']));
	}
}
