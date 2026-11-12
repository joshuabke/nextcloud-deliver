<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use OCA\Deliver\Controller\AttachmentResponse;
use PHPUnit\Framework\TestCase;

/** Download names: Safari shows a percent sign in a quoted filename literally, so the fallback carries none */
class AttachmentResponseTest extends TestCase {
	public function testPlainNameIsSentTwice(): void {
		self::assertSame(
			"attachment; filename=\"cut v2.mp4\"; filename*=UTF-8''cut%20v2.mp4",
			AttachmentResponse::disposition('attachment', 'cut v2.mp4'),
		);
	}

	public function testFallbackHasNoPercentSignOrQuotes(): void {
		self::assertSame(
			"attachment; filename=\"Ton _50__ _final.wav\"; filename*=UTF-8''Ton%20%2250%25%22%20%5Cfinal.wav",
			AttachmentResponse::disposition('attachment', 'Ton "50%" \\final.wav'),
		);
	}

	public function testNonAsciiNameKeepsTheRealNameInFilenameStar(): void {
		self::assertSame(
			"inline; filename=\"Interview M_ller.mp4\"; filename*=UTF-8''Interview%20M%C3%BCller.mp4",
			AttachmentResponse::disposition('inline', 'Interview Müller.mp4'),
		);
	}
}
