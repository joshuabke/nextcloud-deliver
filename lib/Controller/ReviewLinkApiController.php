<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\Scope;
use OCA\Deliver\Service\Contacts;
use OCA\Deliver\Service\ProjectService;
use OCA\Deliver\Service\ReviewerMail;
use OCA\Deliver\Service\ReviewerService;
use OCA\Deliver\Service\ReviewLink;
use OCA\Deliver\Service\ReviewLinks;
use OCA\Deliver\Service\ReviewLinkService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

/** A Project's Review Links (ADR 0010, 0011), its Reviewers and the activity, for every Member who sees it (ADR 0017) */
class ReviewLinkApiController extends OCSController {
	use GuardsErrors;

	private const FIELDS = [...ReviewLink::FLAGS, 'label', 'description', 'password', 'expireDate', 'assetIds'];

	public function __construct(
		string $appName,
		IRequest $request,
		private ReviewLinkService $linkService,
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
	 * The links on a Project, or mine on No Project for 0, and its Reviewers on
	 * any of them, paused or not, each with their Personal Link and own rights
	 * through each live one they are on, for its navigation (story 100, ADR 0014)
	 */
	#[NoAdminRequired]
	public function index(int $id): Response {
		return $this->guard(function () use ($id) {
			$uid = (string)$this->userId;
			$links = $this->linkService->listFor($uid, $id);
			$live = array_filter($links, static fn (array $link) => $link['live']);
			$ofProject = $this->reviewers->ofProject(Scope::of($id === ProjectService::NONE ? null : $id, $uid));
			$inContacts = $this->contacts->among($ofProject);
			['reviewers' => $reviewers, 'on' => $on] = $this->links->reviewersBy($ofProject, array_column($links, 'token'), array_column($live, 'url', 'token'));
			return [
				'links' => array_map(static fn (array $link) => $link + ['reviewerIds' => $on[$link['token']] ?? []], $links),
				// Whether each is in the contacts of whoever asks
				'reviewers' => array_map(static fn (array $reviewer) => $reviewer + ['inContacts' => $inContacts[$reviewer['id']]], $reviewers),
				// Whether an invitation can mail the Personal Link (story 145)
				'canMail' => ReviewerMail::configured($this->config),
			];
		});
	}

	/** @param ?list<int> $assetIds only these Assets; required on No Project (0) */
	#[NoAdminRequired]
	public function create(int $id, ?array $assetIds = null): Response {
		return $this->guard(fn () => $this->linkService->create((string)$this->userId, $id, $assetIds), Http::STATUS_CREATED);
	}

	/** Takes only the fields given, so that assetIds: null can mean the whole Project again */
	#[NoAdminRequired]
	public function update(int $id): Response {
		$fields = array_intersect_key($this->request->getParams(), array_flip(self::FIELDS));
		return $this->guard(fn () => $this->linkService->update((string)$this->userId, $id, $fields));
	}

	#[NoAdminRequired]
	public function destroy(int $id): Response {
		return $this->guard(fn () => $this->linkService->delete((string)$this->userId, $id));
	}

	#[NoAdminRequired]
	public function reviewers(int $id): Response {
		return $this->guard(fn () => $this->links->reviewersOf($this->linkService->ownLink((string)$this->userId, $id)));
	}

	/** A Member invites a Reviewer and, when asked, mails them their Personal Link with a message of their own */
	#[NoAdminRequired]
	public function invite(int $id, string $name, ?string $email = null, bool $sendMail = false, ?string $message = null): Response {
		return $this->guard(function () use ($id, $name, $email, $sendMail, $message) {
			$link = $this->linkService->ownLink((string)$this->userId, $id);
			[$reviewer, $key] = $this->links->invite($link, (string)$this->userId, $name, $email);
			return $this->welcome($link, $reviewer, $key, $sendMail, $message);
		}, Http::STATUS_CREATED);
	}

	/**
	 * Invites one person on a Review Link of their own, showing the whole
	 * Project or the Assets given, with the rights given (story 145). A refused
	 * invitation leaves no link behind.
	 *
	 * @param ?list<int> $assetIds only these Assets; required on No Project (0)
	 */
	#[NoAdminRequired]
	public function invitation(int $id, string $name, ?string $email = null, bool $sendMail = false, ?string $message = null, ?array $assetIds = null): Response {
		return $this->guard(function () use ($id, $name, $email, $sendMail, $message, $assetIds) {
			$uid = (string)$this->userId;
			$linkId = $this->linkService->create($uid, $id, $assetIds)['id'];
			try {
				// A new invitation is live: the rights given, but never paused
				$rights = array_diff(ReviewLink::FLAGS, ['review']);
				$link = $this->linkService->update($uid, $linkId, array_intersect_key($this->request->getParams(), array_flip($rights)));
				$reviewLink = $this->linkService->ownLink($uid, $linkId);
				[$reviewer, $key] = $this->links->invite($reviewLink, $uid, $name, $email);
			} catch (\Throwable $e) {
				$this->linkService->delete($uid, $linkId);
				throw $e;
			}
			// Invited: what follows only tells them, and never takes the link back
			return ['link' => $link, 'reviewer' => $this->welcome($reviewLink, $reviewer, $key, $sendMail, $message)];
		}, Http::STATUS_CREATED);
	}

	/** @return array<string, mixed> the invited Reviewer with their Personal Link, mailed to them when asked */
	private function welcome(ReviewLink $link, Reviewer $reviewer, string $key, bool $sendMail, ?string $message): array {
		$personalLink = $link->personalLink($key);
		$member = $this->userSession->getUser();
		$mailed = $sendMail && $member !== null && $this->mail->invited($reviewer, $personalLink, $member, $message);
		return $this->reviewers->serialize($reviewer) + ['key' => $key, 'link' => $personalLink, 'mailed' => $mailed];
	}

	#[NoAdminRequired]
	public function activity(int $id): Response {
		return $this->guard(fn () => $this->links->activityOf($this->linkService->ownLink((string)$this->userId, $id)));
	}
}
