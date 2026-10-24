<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\Contacts;
use OCA\Deliver\Service\InvalidRequestException;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\Files\NotFoundException;
use OCP\IRequest;

/** A Member's Reviewers, whichever link they came by */
class ReviewerApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ReviewerService $reviewers,
		private ReviewLinks $links,
		private Contacts $contacts,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/** A Member edits a Reviewer of theirs: name, address, mail wishes */
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
			$reviewer = $this->reviewers->update($reviewer, $name, $email, $wishes);
			$this->contacts->checkContacts([$reviewer]);
			return $this->reviewers->serialize($reviewer);
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
	 * Puts a Reviewer of the Member on another of their links of the same
	 * Project, with a Personal Link of its own through it (story 55, ADR 0014)
	 */
	#[NoAdminRequired]
	public function putOn(int $id, string $token): Response {
		return $this->guard(function () use ($id, $token) {
			$reviewer = $this->own($id);
			$link = $this->links->byToken($token);
			if (!$link->takes($reviewer)) {
				throw new NotFoundException('Not a link of the Reviewer\'s Project');
			}
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
	 * @return array{canComment: ?bool, allowOlder: ?bool, watermark: ?bool}
	 * @throws InvalidRequestException not an object of yes, no or null
	 */
	private static function rightsGiven(mixed $rights): array {
		if (!is_array($rights)) {
			throw new InvalidRequestException('Rights are an object of canComment, allowOlder and watermark');
		}
		$given = [];
		foreach (['canComment', 'allowOlder', 'watermark'] as $right) {
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

	/** @throws AccessDeniedException the Reviewer is another Member's (ADR 0009) */
	private function own(int $id): Reviewer {
		$reviewer = $this->reviewers->find($id);
		// A removed Reviewer stays removed: their Personal Links do not come back
		if ($reviewer->getOwnerUid() !== (string)$this->userId || $reviewer->getRemovedAt() !== null) {
			throw new AccessDeniedException('Only the Member a Reviewer belongs to changes them');
		}
		return $reviewer;
	}
}
