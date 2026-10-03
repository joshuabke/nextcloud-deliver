<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Http\RangeFileResponse;
use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\ApprovalService;
use OCA\Deliver\Service\CommentService;
use OCA\Deliver\Service\DerivedMedia;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCA\Deliver\Service\StackService;
use OCA\Deliver\Service\Viewer;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\FileDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\PublicShareController;
use OCP\Files\NotFoundException;
use OCP\IPreview;
use OCP\IRequest;
use OCP\ISession;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * The API behind a Share Link or a Project Link. Token, password and expiry
 * are checked by the framework before an action runs (ADR 0004, 0010); what
 * is left here is who the Reviewer is and what the link's flags allow.
 */
class PublicApiController extends PublicShareController {
	use GuardsErrors;
	use ReviewShareToken;

	public function __construct(
		string $appName,
		IRequest $request,
		ISession $session,
		private ReviewLinks $links,
		private ReviewerService $reviewers,
		private CommentService $comments,
		private DerivedMedia $media,
		private ProjectService $projects,
		private StackService $stacks,
		private IURLGenerator $urls,
		private IUserSession $userSession,
		private ApprovalService $approvals,
		private IPreview $previews,
	) {
		parent::__construct($appName, $request, $session);
	}

	/** One Version with its Version Stack, as far as the link shows it */
	#[PublicPage]
	#[NoCSRFRequired]
	public function context(int $versionId): Response {
		return $this->guard(function () use ($versionId) {
			$link = $this->link();
			$version = $this->links->version($link, $versionId);
			$project = $this->projects->settingsOf($version);
			$stack = $link->assets()[$version->getAssetId()] ?? null;
			$reviewer = $this->reviewer();
			if ($reviewer !== null) {
				$this->reviewers->cameBy($reviewer, $link->token());
			}
			$this->links->record($link, LinkActivityMapper::VIEWED, $reviewer, $version);
			$flags = $this->flags($link, $reviewer);
			return [
				'versionId' => $version->getId(),
				'flags' => $flags,
				'description' => $link->description(),
				'project' => [
					'name' => $link->title(),
					'fps' => ['num' => $project->getFpsNum(), 'den' => $project->getFpsDen()],
					'timecodeMode' => $project->getTimecodeMode(),
				],
				'asset' => $stack === null ? null : ['id' => $stack['asset']->getId(), 'name' => $this->stacks->nameOf($stack['asset']), 'dueDate' => $stack['asset']->getDueDate()],
				'versions' => $stack === null ? [] : array_map(
					fn (Version $each) => $this->describe($link, $each, $flags['canDownload']),
					$stack['versions'],
				),
				'me' => $this->me(),
			];
		});
	}

	/**
	 * Every file the link shows that is an Asset, for the Review button in
	 * the shared file list and the grid of a link's landing page. The button
	 * opens the newest Version (story 61).
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function assets(): Response {
		return $this->guard(function () {
			$link = $this->link();
			$result = [];
			foreach ($link->assets() as ['asset' => $asset, 'versions' => $versions]) {
				foreach ($versions as $version) {
					// The Review button opens the file's own Version; stepping through Assets lands on the newest
					$result[] = [
						'fileId' => $version->getFileId(),
						'versionId' => $version->getId(),
						'newestId' => $versions[0]->getId(),
						'assetId' => $asset->getId(),
						'name' => $this->stacks->nameOf($asset),
						'number' => $versions[0]->getNumber(),
						'count' => count($versions),
						'mimeType' => $link->originalFile($versions[0])?->getMimetype(),
						'dueDate' => $asset->getDueDate(),
					];
				}
			}
			return $result;
		});
	}

	/**
	 * Derived media, or the original when it has to play without a Proxy.
	 * With downloads hidden, the original is not served once a Proxy exists
	 * or is on its way (story 50).
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function media(int $versionId, string $kind): Response {
		try {
			$link = $this->link();
			$version = $this->links->version($link, $versionId);
			if ($kind !== 'original') {
				// Not generated (yet) is a 404 as well; the player falls back to the original
				return RangeFileResponse::ofSimpleFile($this->media->file($version, $kind), $this->request->getHeader('Range'));
			}
			$file = $link->originalFile($version);
			$canDownload = $this->flags($link, $this->reviewer())['canDownload'];
			if ($file === null || !$this->mayPlayOriginal($version, $canDownload)) {
				return new Response(Http::STATUS_NOT_FOUND);
			}
			if ($this->request->getParam('download') !== null && $canDownload) {
				// The download button, not the player, which asks for ranges of the same file (story 124)
				$this->links->record($link, LinkActivityMapper::DOWNLOADED, $this->reviewer(), $version);
				$response = RangeFileResponse::ofFile($file, null);
				$response->addHeader('Content-Disposition', 'attachment; filename="' . rawurlencode($file->getName()) . '"');
				return $response;
			}
			return RangeFileResponse::ofFile($file, $this->request->getHeader('Range'));
		} catch (NotFoundException) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}

	/**
	 * The still of a file behind the link, as Nextcloud renders it, for the
	 * grid; a Project Link has no share of Nextcloud's to ask for it.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function preview(int $fileId, int $x = 64, int $y = 64): Response {
		try {
			$link = $this->link();
			$file = $link->originalFile($this->links->versionForFile($link, $fileId));
			if ($file === null) {
				return new Response(Http::STATUS_NOT_FOUND);
			}
			return new FileDisplayResponse($this->previews->getPreview($file, min($x, 1024), min($y, 1024), true));
		} catch (NotFoundException|\InvalidArgumentException) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}

	/** A Reviewer names themselves once; the answer carries their Personal Link (story 54) */
	#[PublicPage]
	#[NoCSRFRequired]
	public function claim(string $name, ?string $email = null, ?bool $mailReplies = null, ?bool $mailComments = null, ?bool $mailVersions = null): Response {
		return $this->guard(function () use ($name, $email, $mailReplies, $mailComments, $mailVersions) {
			$link = $this->link();
			$wishes = ['replies' => $mailReplies, 'comments' => $mailComments, 'versions' => $mailVersions];
			$reviewer = $this->reviewers->claim($link->ownerUid(), $name, $email, $wishes);
			$this->reviewers->cameBy($reviewer, $link->token());
			// A JSONResponse, because a DataResponse loses its cookies on the way out
			$response = new JSONResponse(
				$this->reviewers->serialize($reviewer) + ['link' => $link->personalLink($reviewer)],
				Http::STATUS_CREATED,
			);
			$this->rememberReviewer($response, $reviewer->getSecretKey());
			return $response;
		});
	}

	/** A Reviewer changes their address or what they want mailed */
	#[PublicPage]
	#[NoCSRFRequired]
	public function settings(?string $email = null, ?bool $mailReplies = null, ?bool $mailComments = null, ?bool $mailVersions = null): Response {
		return $this->guard(function () use ($email, $mailReplies, $mailComments, $mailVersions) {
			$reviewer = $this->reviewer() ?? throw new AccessDeniedException('Give a name first');
			$wishes = ['replies' => $mailReplies, 'comments' => $mailComments, 'versions' => $mailVersions];
			return $this->reviewers->serialize($this->reviewers->updateSettings($reviewer, $email, $wishes));
		});
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function index(int $versionId): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->comments->list($viewer, $version));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function changes(int $versionId, int $since = 0): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->comments->changes($viewer, $version, $since));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function create(int $versionId, int $inFrame, ?int $outFrame = null, string $body = '', ?int $parentId = null, mixed $annotation = null): Response {
		return $this->onVersion(
			$versionId,
			fn ($viewer, $version) => $this->comments->create($viewer, $version, $inFrame, $outFrame, $body, $parentId, $annotation),
			Http::STATUS_CREATED,
		);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function approve(int $versionId, ?string $status = null): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->approvals->decide($viewer, $version, $status));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function seen(int $versionId, ?int $at = null): Response {
		return $this->onVersion($versionId, fn ($viewer, $version) => $this->comments->markSeen($viewer, $version, $at));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function update(int $id, string $body): Response {
		return $this->onComment($id, fn ($viewer, $version) => $this->comments->update($viewer, $version, $id, $body));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function react(int $id, string $emoji, bool $on = true): Response {
		return $this->onComment($id, fn ($viewer, $version) => $this->comments->react($viewer, $version, $id, $emoji, $on));
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function attach(int $id): Response {
		return $this->onComment($id, fn ($viewer, $version) => $this->comments->attach($viewer, $version, $id, $this->request->getUploadedFile('file')), Http::STATUS_CREATED);
	}

	/** An attached file, shown in the browser where it can be */
	#[PublicPage]
	#[NoCSRFRequired]
	public function attachment(int $id): Response {
		try {
			$version = $this->links->version($this->link(), $this->comments->versionIdOfAttachment($id));
			[$file, $attachment] = $this->comments->attachment($version, $id);
			return AttachmentResponse::of($file, $attachment);
		} catch (NotFoundException) {
			return new Response(Http::STATUS_NOT_FOUND);
		}
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function destroy(int $id): Response {
		return $this->onComment($id, function (Viewer $viewer, Version $version) use ($id) {
			$this->comments->remove($viewer, $version, $id);
			return [];
		});
	}

	/** A Version as the Review view shows it, with the original only where the link allows */
	private function describe(ReviewLink $link, Version $version, bool $canDownload): array {
		$media = $this->urls->linkToRoute('deliver.PublicApi.media', [
			'token' => $this->getToken(),
			'versionId' => $version->getId(),
			'kind' => '__kind__',
		]);
		$url = match (true) {
			$canDownload => $link->directUrl($version) ?? str_replace('__kind__', 'original', $media),
			$this->mayPlayOriginal($version, false) => str_replace('__kind__', 'original', $media),
			default => null,
		};
		return $this->projects->describeVersion($version, $this->projects->settingsOf($version), $url, $media);
	}

	/** Without downloads, the original plays only while no Proxy is made for it */
	private function mayPlayOriginal(Version $version, bool $canDownload): bool {
		return $canDownload || in_array($version->getProxyState(), [DerivedMedia::STATE_NONE, DerivedMedia::STATE_FAILED], true);
	}

	/** Who is writing: the Reviewer this browser carries, or someone without a name yet */
	private function me(): array {
		$reviewer = $this->reviewer();
		return $reviewer === null
			// A logged-in visitor gets their display name offered (story 58)
			? ['type' => 'unnamed', 'name' => $this->userSession->getUser()?->getDisplayName() ?? '']
			: ['type' => 'reviewer', 'id' => $reviewer->getId(), 'name' => $reviewer->getName(), 'email' => $reviewer->getEmail(), 'mail' => $reviewer->mailWishes()];
	}

	private function reviewer(): ?Reviewer {
		$key = $this->request->getCookie(self::cookieName($this->getToken())) ?? $this->request->getParam('r');
		return $this->reviewers->byKey(is_string($key) ? $key : null, $this->link());
	}

	/**
	 * The link's review flags, with the Reviewer's own rights over them
	 *
	 * @return array<string, mixed>
	 */
	private function flags(ReviewLink $link, ?Reviewer $reviewer): array {
		$flags = $link->flags();
		return $reviewer === null ? $flags : $reviewer->over($flags);
	}

	/** A Reviewer comments while the link or their own rights allow it, and never resolves */
	private function viewer(ReviewLink $link): Viewer {
		$reviewer = $this->reviewer();
		$flags = $this->flags($link, $reviewer);
		return $reviewer === null
			? Viewer::unnamed($flags['canComment'], $flags['allowOlder'])
			: Viewer::reviewer($reviewer->getId(), $flags['canComment'], $flags['allowOlder']);
	}

	private function onVersion(int $versionId, callable $action, int $status = Http::STATUS_OK): Response {
		return $this->guard(function () use ($versionId, $action) {
			$link = $this->link();
			return $action($this->viewer($link), $this->links->version($link, $versionId));
		}, $status);
	}

	private function onComment(int $id, callable $action, int $status = Http::STATUS_OK): Response {
		return $this->guard(function () use ($id, $action) {
			$link = $this->link();
			return $action($this->viewer($link), $this->links->version($link, $this->comments->versionIdOf($id)));
		}, $status);
	}
}
