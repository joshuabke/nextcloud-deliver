<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Db\Scope;
use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\Contacts;
use OCA\Deliver\Service\InvalidRequestException;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCA\Deliver\Service\ReviewLinkService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\Files\NotFoundException;
use OCP\IRequest;

/**
 * A Project's Reviewers, on whichever of its links, for every Member who sees it (ADR 0017)
 *
 * @psalm-import-type Rights from ReviewerMapper
 */
class ReviewerApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ReviewerService $reviewers,
		private ReviewLinks $links,
		private ReviewLinkService $linkService,
		private Contacts $contacts,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/** A Member edits a Reviewer of the Project: name, address, mail wishes */
	#[NoAdminRequired]
	public function update(
		int $id,
		string $name,
		?string $email = null,
		?bool $mailReplies = null,
		?bool $mailComments = null,
		?bool $mailVersions = null,
	): Response {
		return $this->guard(function () use ($id, $name, $email, $mailReplies, $mailComments, $mailVersions) {
			$reviewer = $this->own($id);
			$this->links->assertRenameFree($reviewer, $name);
			$this->links->assertAddressFree($reviewer, $email);
			$wishes = ['replies' => $mailReplies, 'comments' => $mailComments, 'versions' => $mailVersions];
			return $this->reviewers->serialize($this->reviewers->update($reviewer, $name, $email, $wishes));
		});
	}

	/**
	 * A Member sets a Reviewer's own rights on one link they are on, over the
	 * link's (ADR 0014)
	 *
	 * @param mixed $rights {canComment, allowOlder, watermark}, each true, false, or null to leave it to the link
	 */
	#[NoAdminRequired]
	public function rights(int $id, string $token, mixed $rights = []): Response {
		return $this->guard(fn () => $this->links->setRights($this->own($id), $token, self::rightsGiven($rights)));
	}

	/**
	 * Puts a Reviewer on another link of their Project, with a Personal Link of
	 * its own through it (story 55, ADR 0014)
	 */
	#[NoAdminRequired]
	public function putOn(int $id, string $token): Response {
		return $this->guard(function () use ($id, $token) {
			$reviewer = $this->own($id);
			$link = $this->links->byToken($token);
			if (!$link->takes($reviewer)) {
				throw new NotFoundException('Not a link of the Reviewer\'s Project');
			}
			// A name taken in this review meanwhile, a Member's among them, does not come along
			$this->links->assertNameFree($link, $reviewer->getName(), $reviewer);
			$key = $this->reviewers->putOn($reviewer, $link->token());
			return ['key' => $key, 'link' => $link->personalLink($key)];
		}, Http::STATUS_CREATED);
	}

	/** Takes a Reviewer off one link: their Personal Link through it stops working, the rest stays */
	#[NoAdminRequired]
	public function takeOff(int $id, string $token): Response {
		return $this->guard(fn () => $this->reviewers->takeOff($this->own($id), $token));
	}

	/**
	 * @return Rights
	 * @throws InvalidRequestException not an object of yes, no or null
	 */
	private static function rightsGiven(mixed $rights): array {
		if (!is_array($rights)) {
			throw new InvalidRequestException('Rights are an object of canComment, allowOlder and watermark');
		}
		$given = [];
		foreach (ReviewLink::OWN_RIGHTS as $right) {
			$value = $rights[$right] ?? null;
			$given[$right] = $value === null ? null : filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
			if ($value !== null && $given[$right] === null) {
				throw new InvalidRequestException("$right is yes, no or null");
			}
		}
		return $given;
	}

	/** Saves the Reviewer's name and address to the Member's Contacts, unless the address is there already (#66) */
	#[NoAdminRequired]
	public function saveContact(int $id): Response {
		return $this->guard(function () use ($id) {
			$saved = $this->contacts->save($this->own($id));
			return new DataResponse(['saved' => $saved], $saved ? Http::STATUS_CREATED : Http::STATUS_OK);
		});
	}

	/** A new Personal Link for a Reviewer; the old ones stop working */
	#[NoAdminRequired]
	public function renewKey(int $id): Response {
		return $this->guard(fn () => $this->reviewers->serialize($this->reviewers->renewKeys($this->own($id))));
	}

	/** The Reviewer's Personal Links stop working and they leave the lists; their Comments stay */
	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->guard(fn () => $this->reviewers->remove($this->own($id)));
	}

	/**
	 * @throws NotFoundException a Project the Member does not see
	 * @throws AccessDeniedException a removed Reviewer, or another Member's on No Project
	 */
	private function own(int $id): Reviewer {
		$reviewer = $this->reviewers->find($id);
		// A removed Reviewer stays removed: their Personal Links do not come back
		if ($reviewer->getRemovedAt() !== null) {
			throw new AccessDeniedException('A removed Reviewer is not changed');
		}
		$this->linkService->mayManage((string)$this->userId, Scope::ofReviewer($reviewer));
		return $reviewer;
	}
}
