<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

/**
 * Minimal HTTP client for a running Nextcloud: WebDAV for Files, OCS for Deliver.
 * Basic auth on every request; OCS-APIREQUEST makes the CSRF check accept it.
 */
class NextcloudClient {
	public function __construct(
		private string $baseUrl,
		public readonly string $user,
		private string $password,
	) {
	}

	/** @return array{status: int, body: string} */
	public function request(string $method, string $path, ?string $body = null, array $headers = []): array {
		$ch = curl_init($this->baseUrl . $path);
		curl_setopt_array($ch, [
			CURLOPT_CUSTOMREQUEST => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_USERPWD => $this->user . ':' . $this->password,
			CURLOPT_HTTPHEADER => array_merge(['OCS-APIREQUEST: true'], $headers),
		]);
		if ($body !== null) {
			curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
		}
		$response = curl_exec($ch);
		if ($response === false) {
			throw new \RuntimeException('curl: ' . curl_error($ch));
		}
		$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		return ['status' => $status, 'body' => (string)$response];
	}

	/**
	 * Uploads one file as the form field `file` to an OCS path.
	 *
	 * @return array{status: int, data: mixed}
	 */
	public function upload(string $path, string $name, string $content): array {
		$ch = curl_init($this->baseUrl . '/ocs/v2.php/apps/deliver/api/v1' . $path . '?format=json');
		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_USERPWD => $this->user . ':' . $this->password,
			CURLOPT_HTTPHEADER => ['OCS-APIREQUEST: true', 'Accept: application/json'],
			CURLOPT_POSTFIELDS => ['file' => new \CURLStringFile($content, $name)],
		]);
		$decoded = json_decode((string)curl_exec($ch), true);
		return ['status' => (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'data' => $decoded['ocs']['data'] ?? $decoded];
	}

	/** @return array{status: int, data: mixed} the OCS status and unwrapped data */
	public function ocs(string $method, string $path, array $json = []): array {
		$response = $this->request(
			$method,
			'/ocs/v2.php/apps/deliver/api/v1' . $path . (str_contains($path, '?') ? '&' : '?') . 'format=json',
			$json === [] ? null : json_encode($json, JSON_THROW_ON_ERROR),
			['Content-Type: application/json', 'Accept: application/json'],
		);
		$decoded = json_decode($response['body'], true);
		return ['status' => $response['status'], 'data' => $decoded['ocs']['data'] ?? $decoded];
	}

	/** @return array{status: int, data: mixed} any other OCS endpoint, form-encoded */
	public function ocsForm(string $method, string $path, array $fields = []): array {
		$response = $this->request(
			$method,
			$path . (str_contains($path, '?') ? '&' : '?') . 'format=json',
			$fields === [] ? null : http_build_query($fields),
			['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
		);
		$decoded = json_decode($response['body'], true);
		return ['status' => $response['status'], 'data' => $decoded['ocs']['data'] ?? $decoded];
	}

	public function withUser(string $user, string $password): self {
		return new self($this->baseUrl, $user, $password);
	}

	private function dav(string $path): string {
		return '/remote.php/dav/files/' . rawurlencode($this->user) . '/' . implode('/', array_map('rawurlencode', explode('/', trim($path, '/'))));
	}

	public function mkdir(string $path): void {
		$status = $this->request('MKCOL', $this->dav($path))['status'];
		if ($status !== 201) {
			throw new \RuntimeException("MKCOL $path failed: $status");
		}
	}

	public function put(string $path, string $content): void {
		$status = $this->request('PUT', $this->dav($path), $content)['status'];
		if (!in_array($status, [201, 204], true)) {
			throw new \RuntimeException("PUT $path failed: $status");
		}
	}

	public function move(string $from, string $to): void {
		$status = $this->request('MOVE', $this->dav($from), null, ['Destination: ' . $this->baseUrl . $this->dav($to)])['status'];
		if (!in_array($status, [201, 204], true)) {
			throw new \RuntimeException("MOVE $from failed: $status");
		}
	}

	public function delete(string $path): void {
		$this->request('DELETE', $this->dav($path));
	}

	/** Empties the trash, which is what permanent deletion looks like from outside */
	public function emptyTrash(): void {
		$this->request('DELETE', '/remote.php/dav/trashbin/' . rawurlencode($this->user) . '/trash');
	}

	public function fileId(string $path): int {
		$response = $this->request(
			'PROPFIND',
			$this->dav($path),
			'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
			['Depth: 0', 'Content-Type: application/xml'],
		);
		if ($response['status'] !== 207 || preg_match('#<oc:fileid>(\d+)</oc:fileid>#', $response['body'], $m) !== 1) {
			throw new \RuntimeException("PROPFIND $path failed: {$response['status']}");
		}
		return (int)$m[1];
	}
}
