<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Service\AccessDeniedException;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** A Member's Reviewers, whichever link they came by */
class ReviewerApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private ReviewerService $reviewers,
		private ReviewLinks $links,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/** A Member edits a Reviewer of theirs: name, address, mail wishes, own rights */
	#[NoAdminRequired]
	public function update(
		int $id,
		string $name,
		?string $email = null,
		?bool $mailReplies = null,
		?bool $mailComments = null,
		?bool $mailVersions = null,
		?array $rights = null,
	): Response {
		return $this->guard(function () use ($id, $name, $email, $mailReplies, $mailComments, $mailVersions, $rights) {
			$reviewer = $this->own($id);
			$this->links->assertRenameFree($reviewer, $name);
			$wishes = ['replies' => $mailReplies, 'comments' => $mailComments, 'versions' => $mailVersions];
			return $this->reviewers->serialize($this->reviewers->update($reviewer, $name, $email, $wishes, $rights));
		});
	}

	/** A new Personal Link for a Reviewer; the old ones stop working */
	#[NoAdminRequired]
	public function renewKey(int $id): Response {
		return $this->guard(fn () => $this->reviewers->serialize($this->reviewers->renewKey($this->own($id))));
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
		if ($reviewer->getOwnerUid() !== (string)$this->userId || $reviewer->getSecretKey() === null) {
			throw new AccessDeniedException('Only the Member a Reviewer belongs to changes them');
		}
		return $reviewer;
	}
}
