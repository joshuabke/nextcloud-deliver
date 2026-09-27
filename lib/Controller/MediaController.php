<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\CommentService;
use OCA\Deliver\Service\DerivedMedia;
use OCA\Deliver\Service\ProjectService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Response;
use OCP\Files\NotFoundException;
use OCP\IRequest;

/** Derived media and attachments for Members; Reviewers get them through PublicApiController */
class MediaController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectService $projects,
		private DerivedMedia $media,
		private CommentService $comments,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function show(int $id, string $kind): Response {
		try {
			[, $version] = $this->projects->viewerForVersion((string)$this->userId, $id);
			return DerivedMediaResponse::of($this->media, $version, $kind, $this->request->getHeader('Range'));
		} catch (NotFoundException) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}

	/** An attached file, shown in the browser where it can be (story 92) */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function attachment(int $id): Response {
		try {
			[, $version] = $this->projects->viewerForVersion((string)$this->userId, $this->comments->versionIdOfAttachment($id));
			[$file, $attachment] = $this->comments->attachment($version, $id);
			return AttachmentResponse::of($file, $attachment);
		} catch (NotFoundException) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}
}
