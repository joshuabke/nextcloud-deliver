<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\InvalidRequestException;
use OCA\Deliver\Service\ProjectConflictException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Response;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;

/** Runs a service call and answers its exceptions with the matching HTTP status */
trait GuardsErrors {
	private function guard(callable $action, int $status = Http::STATUS_OK): Response {
		try {
			$result = $action();
			return $result instanceof Response ? $result : new DataResponse($result, $status);
		} catch (NotFoundException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		} catch (AccessDeniedException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (NotPermittedException) {
			// Files refused a write the service had not foreseen
			return new DataResponse(['message' => 'Files does not let you do this'], Http::STATUS_FORBIDDEN);
		} catch (ProjectConflictException $e) {
			return new DataResponse(['message' => $e->getMessage()] + ($e->reason === null ? [] : ['reason' => $e->reason]) + $e->details, Http::STATUS_CONFLICT);
		} catch (InvalidRequestException $e) {
			return new DataResponse(['message' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
	}
}
