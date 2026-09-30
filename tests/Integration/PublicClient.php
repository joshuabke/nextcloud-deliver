<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

/**
 * A Reviewer's side of a Share Link: no account, no Nextcloud session, just the
 * token, whatever the share allows, and a cookie that remembers who they are.
 */
class PublicClient {
	private string $jar;

	public function __construct(
		private string $baseUrl,
		private string $token,
	) {
		$this->jar = tempnam(sys_get_temp_dir(), 'deliver-reviewer-');
	}

	public function __destruct() {
		@unlink($this->jar);
	}

	/** A fresh browser: same link, nothing remembered */
	public function otherDevice(): self {
		return new self($this->baseUrl, $this->token);
	}

	/** @return array{status: int, data: mixed} */
	public function call(string $method, string $path, array $json = []): array {
		$ch = curl_init($this->baseUrl . '/apps/deliver/s/' . $this->token . $path);
		curl_setopt_array($ch, [
			CURLOPT_CUSTOMREQUEST => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_COOKIEJAR => $this->jar,
			CURLOPT_COOKIEFILE => $this->jar,
			CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
		]);
		if ($json !== []) {
			curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json, JSON_THROW_ON_ERROR));
		}
		$body = (string)curl_exec($ch);
		$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		return ['status' => $status, 'data' => json_decode($body, true)];
	}

	/**
	 * Uploads one file as the form field `file`, or fetches a path raw; '' is the review page itself.
	 *
	 * @return array{status: int, body: string, type: string}
	 */
	public function raw(string $path, ?string $name = null, ?string $content = null): array {
		$ch = curl_init($this->baseUrl . '/apps/deliver/s/' . $this->token . $path);
		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_COOKIEJAR => $this->jar,
			CURLOPT_COOKIEFILE => $this->jar,
		]);
		if ($name !== null) {
			curl_setopt($ch, CURLOPT_POSTFIELDS, ['file' => new \CURLStringFile((string)$content, $name)]);
		}
		$body = (string)curl_exec($ch);
		return [
			'status' => (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
			'body' => $body,
			'type' => (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE),
		];
	}
}
