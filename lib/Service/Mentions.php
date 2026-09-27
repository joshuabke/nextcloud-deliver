<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/**
 * @mentions in a Comment (story 90): `@uid`, or `@"uid"` where the user id
 * holds characters that end a word, as Nextcloud Talk writes them.
 */
final class Mentions {
	private const PATTERN = '/(?<![\w@])@(?:"([^"\n]+)"|([\w.@-]+))/u';

	/** @return list<string> the user ids mentioned, each once, in order */
	public static function parse(string $body): array {
		preg_match_all(self::PATTERN, $body, $matches, PREG_SET_ORDER);
		$uids = [];
		foreach ($matches as $match) {
			// A sentence may end right after the name: "thanks @anna."
			$uids[] = ($match[1] ?? '') !== '' ? $match[1] : rtrim($match[2], '.-');
		}
		return array_values(array_unique(array_filter($uids, static fn (string $uid) => $uid !== '')));
	}

	/**
	 * The body as people read it, for exports and mail.
	 *
	 * @param array<string, string> $names user id → display name
	 */
	public static function render(string $body, array $names): string {
		return (string)preg_replace_callback(self::PATTERN, static function (array $match) use ($names): string {
			$quoted = ($match[1] ?? '') !== '';
			$uid = $quoted ? $match[1] : rtrim($match[2], '.-');
			if (!isset($names[$uid])) {
				return $match[0];
			}
			// What rtrim took off belongs to the sentence
			return '@' . $names[$uid] . ($quoted ? '' : substr($match[2], strlen($uid)));
		}, $body);
	}
}
