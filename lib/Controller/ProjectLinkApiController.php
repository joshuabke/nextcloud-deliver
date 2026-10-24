<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Service\Contacts;
use OCA\Deliver\Service\ProjectLinkService;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ReviewerMail;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

/** A Member's Project Links (ADR 0010, 0011), their Reviewers and activity */
class ProjectLinkApiController extends OCSController {
	use GuardsErrors;

	private const FIELDS = [...ReviewLink::FLAGS, 'label', 'description', 'password', 'expireDate', 'assetIds'];

	public function __construct(
		string $appName,
		IRequest $request,
		private ProjectLinkService $projectLinks,
		private ReviewLinks $links,
		private ReviewerService $reviewers,
		private ReviewerMail $mail,
		private IUserSession $userSession,
		private Contacts $contacts,
		private IConfig $config,
		private ?string $userId,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * My links on a Project, or on No Project for 0, and my Reviewers on any of
	 * them, paused or not, each with their Personal Link and own rights through
	 * each live one they are on, for its navigation (story 100, ADR 0014)
	 */
	#[NoAdminRequired]
	public function index(int $id): Response {
		return $this->guard(function () use ($id) {
			$uid = (string)$this->userId;
			$links = $this->projectLinks->listFor($uid, $id);
			$live = array_filter($links, static fn (array $link) => $link['review']);
			['reviewers' => $reviewers, 'cameBy' => $cameBy] = $this->links->reviewersBy($uid, $id === ProjectService::NONE ? null : $id, array_column($links, 'token'), array_column($live, 'url', 'token'));
			return [
				'links' => array_map(static fn (array $link) => $link + ['reviewerIds' => $cameBy[$link['token']] ?? []], $links),
				'reviewers' => $reviewers,
				// Whether an invitation can mail the Personal Link (story 145)
				'canMail' => ReviewerMail::configured($this->config),
			];
		});
	}

	/** @param ?list<int> $assetIds only these Assets; required on No Project (0) */
	#[NoAdminRequired]
	public function create(int $id, ?array $assetIds = null): Response {
		return $this->guard(fn () => $this->projectLinks->create((string)$this->userId, $id, $assetIds), Http::STATUS_CREATED);
	}

	/** Takes only the fields given, so that assetIds: null can mean the whole Project again */
	#[NoAdminRequired]
	public function update(int $id): Response {
		$fields = array_intersect_key($this->request->getParams(), array_flip(self::FIELDS));
		return $this->guard(fn () => $this->projectLinks->update((string)$this->userId, $id, $fields));
	}

	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->guard(fn () => $this->projectLinks->delete((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function reviewers(int $id): Response {
		return $this->guard(fn () => $this->links->reviewersOf($this->projectLinks->ownLink((string)$this->userId, $id)));
	}

	/** A Member invites a Reviewer and, when asked, mails them their Personal Link with a message of their own */
	#[NoAdminRequired]
	public function invite(int $id, string $name, ?string $email = null, bool $sendMail = false, ?string $message = null): Response {
		return $this->guard(function () use ($id, $name, $email, $sendMail, $message) {
			$link = $this->projectLinks->ownLink((string)$this->userId, $id);
			return $this->welcome($link, $this->links->invite($link, $name, $email), $sendMail, $message);
		}, Http::STATUS_CREATED);
	}

	/**
	 * Invites one person on a Project Link of their own, showing the whole
	 * Project or the Assets given, with the rights given (story 145). A refused
	 * invitation leaves no link behind.
	 *
	 * @param ?list<int> $assetIds only these Assets; required on No Project (0)
	 */
	#[NoAdminRequired]
	public function invitation(int $id, string $name, ?string $email = null, bool $sendMail = false, ?string $message = null, ?array $assetIds = null): Response {
		return $this->guard(function () use ($id, $name, $email, $sendMail, $message, $assetIds) {
			$uid = (string)$this->userId;
			$linkId = $this->projectLinks->create($uid, $id, $assetIds)['id'];
			try {
				$link = $this->projectLinks->update($uid, $linkId, array_intersect_key($this->request->getParams(), array_flip(ReviewLink::FLAGS)));
				$reviewLink = $this->projectLinks->ownLink($uid, $linkId);
				$reviewer = $this->links->invite($reviewLink, $name, $email);
			} catch (\Throwable $e) {
				$this->projectLinks->delete($uid, $linkId);
				throw $e;
			}
			// Invited: what follows only tells them, and never takes the link back
			return ['link' => $link, 'reviewer' => $this->welcome($reviewLink, $reviewer, $sendMail, $message)];
		}, Http::STATUS_CREATED);
	}

	/** @return array<string, mixed> the invited Reviewer with their Personal Link, mailed to them when asked */
	private function welcome(ReviewLink $link, Reviewer $reviewer, bool $sendMail, ?string $message): array {
		$this->contacts->checkContacts([$reviewer]);
		$personalLink = $link->personalLink($reviewer);
		$member = $this->userSession->getUser();
		$mailed = $sendMail && $member !== null && $this->mail->invited($reviewer, $personalLink, $member, $message);
		return $this->reviewers->serialize($reviewer) + ['link' => $personalLink, 'mailed' => $mailed];
	}

	#[NoAdminRequired]
	public function activity(int $id): Response {
		return $this->guard(fn () => $this->links->activityOf($this->projectLinks->ownLink((string)$this->userId, $id)));
	}
}
