<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * A finger on the scrolling Waveform drags the wave through time. With
 * `touch-action: pan-y` iOS Safari hands the touch to the page's scrolling and
 * cancels the pointer (pointercancel) once the finger drifts about 10 px
 * upright, mid-swipe, which no desktop browser does. The stage has to take
 * every touch. This reads the code, as nothing but a phone shows it.
 */
class WaveformTouchActionTest extends TestCase {
	public function testTheStageTakesEveryTouch(): void {
		$code = file_get_contents(dirname(__DIR__, 2) . '/src/components/WaveformStage.vue');
		self::assertSame(1, preg_match('/\.deliver-wave \{[^}]*touch-action:\s*none;/', $code), '.deliver-wave must be touch-action: none');
	}
}
