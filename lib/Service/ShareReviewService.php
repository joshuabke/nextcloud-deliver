<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Project;
use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\Constants;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IConfig;
use OCP\IURLGenerator;
use OCP\Share\Exceptions\ShareNotFound;
use OCP\Share\IManager as IShareManager;
use OCP\Share\IShare;

/**
 * Review on Nextcloud's own Share Links (ADR 0004). Deliver keeps no link of
 * its own: a link share is a review surface while its `deliver/review`
 * attribute is set, and password, expiry and revocation stay with the share.
 */
class ShareReviewService {
	public const SCOPE = 'deliver';
	public const FLAG_REVIEW = 'review';
	public const FLAG_COMMENT = 'comment';
	public const FLAG_OLDER = 'older';
	public const FLAG_WATERMARK = 'watermark';

	public function __construct(
		private IShareManager $shares,
		private IRootFolder $root,
		private ProjectMapper $projects,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private ReviewerService $reviewers,
		private IURLGenerator $urls,
		private IConfig $config,
	) {
	}

	/** @throws NotFoundException no such link share */
	public function byToken(string $token): IShare {
		try {
			$share = $this->shares->getShareByToken($token);
		} catch (ShareNotFound) {
			throw new NotFoundException('Share not found');
		}
		if (!in_array($share->getShareType(), [IShare::TYPE_LINK, IShare::TYPE_EMAIL], true)) {
			throw new NotFoundException('Share not found');
		}
		return $share;
	}

	/** Whether a Member switched review on for this share */
	public function isReview(IShare $share): bool {
		return $this->flag($share, self::FLAG_REVIEW, false);
	}

	/** @return array{review: bool, canComment: bool, allowOlder: bool, watermark: bool, canDownload: bool} */
	public function flags(IShare $share): array {
		return [
			'review' => $this->isReview($share),
			'canComment' => $this->flag($share, self::FLAG_COMMENT, true),
			'allowOlder' => $this->flag($share, self::FLAG_OLDER, false),
			// The Reviewer's name over the picture (story 94)
			'watermark' => $this->flag($share, self::FLAG_WATERMARK, false),
			'canDownload' => $share->canSeeContent() && !$share->getHideDownload(),
		];
	}

	/**
	 * Sets the flags that are given and leaves the rest of the share alone.
	 *
	 * @throws AccessDeniedException the user may not change this share
	 */
	public function setFlags(string $uid, int $shareId, ?bool $review, ?bool $canComment, ?bool $allowOlder, ?bool $watermark = null): IShare {
		$share = $this->ownShare($uid, $shareId);
		$attributes = $share->getAttributes() ?? $share->newAttributes();
		foreach ([self::FLAG_REVIEW => $review, self::FLAG_COMMENT => $canComment, self::FLAG_OLDER => $allowOlder, self::FLAG_WATERMARK => $watermark] as $key => $value) {
			if ($value !== null) {
				$attributes->setAttribute(self::SCOPE, $key, $value);
			}
		}
		$share->setAttributes($attributes);
		return $this->shares->updateShare($share);
	}

	public function checkPassword(IShare $share, string $password): bool {
		return $this->shares->checkPassword($share, $password);
	}

	/**
	 * The user's Share Links of one node, with Deliver's flags, for the Files sidebar.
	 *
	 * @return list<array<string, mixed>>
	 */
	public function linksFor(string $uid, int $fileId): array {
		$node = $this->userNode($uid, $fileId);
		$shares = $this->shares->getSharesBy($uid, IShare::TYPE_LINK, $node, false, -1);
		return array_map(fn (IShare $share) => $this->serialize($share), $shares);
	}

	/**
	 * A new Share Link with review already on (story 45).
	 *
	 * @throws AccessDeniedException the node is read-only for the user
	 */
	public function createLink(string $uid, int $fileId): array {
		$node = $this->userNode($uid, $fileId);
		$this->assertWritable($node);
		$share = $this->shares->newShare();
		$share->setNode($node);
		$share->setShareType(IShare::TYPE_LINK);
		$share->setSharedBy($uid);
		$share->setPermissions(Constants::PERMISSION_READ);
		$attributes = $share->newAttributes();
		$attributes->setAttribute(self::SCOPE, self::FLAG_REVIEW, true);
		$share->setAttributes($attributes);
		return $this->serialize($this->shares->createShare($share));
	}

	/**
	 * The Reviewers of the share's Project, each with a Personal Link through
	 * this share, so a replaced link can be handed out again (story 55).
	 *
	 * @return list<array<string, mixed>>
	 */
	public function reviewersOf(string $uid, int $shareId): array {
		$share = $this->ownShare($uid, $shareId);
		return array_map(
			fn (Reviewer $reviewer) => $this->reviewerWithLink($share, $reviewer),
			$this->reviewers->forProject($this->project($share)),
		);
	}

	/**
	 * A new Reviewer, invited by a Member, with their Personal Link (story 53).
	 *
	 * @throws InvalidRequestException the name is empty or the email is not one
	 */
	public function invite(string $uid, int $shareId, string $name, ?string $email): array {
		$share = $this->ownShare($uid, $shareId);
		return $this->reviewerWithLink($share, $this->reviewers->claim($this->project($share), $name, $email));
	}

	/** The share URL plus the Reviewer's key: whoever opens it is that Reviewer */
	public function personalLink(IShare $share, Reviewer $reviewer): string {
		return $this->shareUrl($share) . '?r=' . rawurlencode($reviewer->getSecretKey());
	}

	/**
	 * The Review view of the Version through some review Share Link that shows
	 * it, with the Reviewer's key, for mails; null when none does any more.
	 * It opens the player straight away rather than the shared file list.
	 */
	public function reviewLinkFor(Version $version, Reviewer $reviewer): ?string {
		try {
			$project = $this->projects->find($version->getProjectId());
		} catch (\OCP\AppFramework\Db\DoesNotExistException) {
			return null;
		}
		$folder = $this->root->getFirstNodeById($project->getFolderId());
		$node = $folder instanceof Folder ? $folder->getFirstNodeById($version->getFileId()) : null;
		$owner = $folder?->getOwner()?->getUID();
		// From the file up to the Project folder, the nearest review link wins
		for (; $node !== null && $owner !== null; $node = $node->getId() === $folder->getId() ? null : $node->getParent()) {
			foreach ($this->shares->getSharesBy($owner, IShare::TYPE_LINK, $node, true, -1) as $share) {
				if ($this->isReview($share)) {
					return $this->instanceUrl($this->urls->linkToRoute('deliver.Public.showVersion', ['token' => $share->getToken(), 'versionId' => $version->getId()]))
						. '?r=' . rawurlencode($reviewer->getSecretKey());
				}
			}
		}
		return null;
	}

	private function reviewerWithLink(IShare $share, Reviewer $reviewer): array {
		return $this->reviewers->serialize($reviewer) + ['link' => $this->personalLink($share, $reviewer)];
	}

	/**
	 * A path on the instance's own address (overwrite.cli.url), for mails:
	 * the request that sent one may have come in through localhost or an IP.
	 */
	private function instanceUrl(string $path): string {
		$base = parse_url($this->config->getSystemValueString('overwrite.cli.url'));
		if (!isset($base['scheme'], $base['host'])) {
			return $this->urls->getAbsoluteURL($path);
		}
		return $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '') . $path;
	}

	private function shareUrl(IShare $share): string {
		return $this->urls->getAbsoluteURL('/s/' . $share->getToken());
	}

	/**
	 * A share the user may change: one they created or own, on a node they can write to.
	 *
	 * @throws NotFoundException no such share for this user
	 * @throws AccessDeniedException the user may not change it
	 */
	private function ownShare(string $uid, int $shareId): IShare {
		try {
			$share = $this->shares->getShareById('ocinternal:' . $shareId, $uid);
		} catch (ShareNotFound) {
			throw new NotFoundException('Share not found');
		}
		if ($share->getSharedBy() !== $uid && $share->getShareOwner() !== $uid) {
			throw new AccessDeniedException('Only the person who shared it can change this link');
		}
		$this->assertWritable($this->userNode($uid, $share->getNodeId()));
		return $share;
	}

	/** @throws NotFoundException the user cannot reach the node */
	private function userNode(string $uid, int $fileId): Node {
		$node = $this->root->getUserFolder($uid)->getFirstNodeById($fileId);
		if ($node === null) {
			throw new NotFoundException('File not found');
		}
		return $node;
	}

	/** @throws AccessDeniedException review settings need write access (spec: Permissions) */
	private function assertWritable(Node $node): void {
		if (($node->getPermissions() & Constants::PERMISSION_UPDATE) === 0) {
			throw new AccessDeniedException('Write permission is required');
		}
	}

	public function serialize(IShare $share): array {
		return [
			'id' => (int)$share->getId(),
			'token' => $share->getToken(),
			'url' => $this->shareUrl($share),
			'label' => $share->getLabel(),
			'hasPassword' => $share->getPassword() !== null,
			'expiresAt' => $share->getExpirationDate()?->getTimestamp(),
			// Whether Reviewers can be mailed about Replies at all (story 66)
			'canMail' => ReviewerMail::configured($this->config),
		] + $this->flags($share);
	}

	/**
	 * The Project the shared node lies in, looked up in the owner's tree, so
	 * it does not matter who opened the link.
	 *
	 * @throws NotFoundException the shared node is not in a Project
	 */
	public function project(IShare $share): Project {
		$node = $this->node($share);
		$folder = $node instanceof Folder ? $node : $node->getParent();
		for (; $folder instanceof Folder; $folder = $folder->getParent()) {
			$project = $this->projects->findByFolderId($folder->getId());
			if ($project !== null) {
				return $project;
			}
			if ($folder->getPath() === '' || $folder->getPath() === '/') {
				break;
			}
		}
		throw new NotFoundException('This link does not reach into a Project');
	}

	/**
	 * The Assets this Share Link shows, each with the Versions inside the
	 * shared node, highest Version Number first.
	 *
	 * @return array<int, array{asset: Asset, versions: Version[]}>
	 */
	public function assets(IShare $share): array {
		$project = $this->project($share);
		$node = $this->node($share);
		$byAsset = [];
		foreach ($this->versions->findByProject($project->getId()) as $version) {
			if ($this->contains($node, $version->getFileId())) {
				$byAsset[$version->getAssetId()][] = $version;
			}
		}
		$result = [];
		foreach ($this->assets->findByProject($project->getId()) as $asset) {
			if (isset($byAsset[$asset->getId()])) {
				$result[$asset->getId()] = ['asset' => $asset, 'versions' => $byAsset[$asset->getId()]];
			}
		}
		return $result;
	}

	/**
	 * The Version of a file inside the share, for the Review button in the shared file list.
	 *
	 * @throws NotFoundException the file is not an Asset of this Share Link
	 */
	public function versionForFile(IShare $share, int $fileId): Version {
		$project = $this->project($share);
		$version = $this->versions->findByProjectAndFile($project->getId(), $fileId);
		if ($version === null || !$this->contains($this->node($share), $fileId)) {
			throw new NotFoundException('This file is not enabled for review');
		}
		return $version;
	}

	/** @throws NotFoundException the Version is outside what this link shows */
	public function version(IShare $share, int $versionId): Version {
		$version = $this->versions->find($versionId);
		if ($version === null
			|| $version->getProjectId() !== $this->project($share)->getId()
			|| !$this->contains($this->node($share), $version->getFileId())) {
			throw new NotFoundException('Version not found');
		}
		return $version;
	}

	/** The original through the share's public WebDAV, which serves ranges; null when it is not inside the share */
	public function mediaUrl(IShare $share, Version $version): ?string {
		$node = $this->node($share);
		if ($node instanceof File) {
			return $node->getId() === $version->getFileId()
				? $this->urls->getAbsoluteURL('/public.php/dav/files/' . $share->getToken())
				: null;
		}
		$found = $node instanceof Folder ? $node->getById($version->getFileId()) : [];
		if ($found === []) {
			return null;
		}
		$relative = substr($found[0]->getPath(), strlen($node->getPath()));
		return $this->urls->getAbsoluteURL('/public.php/dav/files/' . $share->getToken() . implode(
			'/',
			array_map('rawurlencode', explode('/', $relative)),
		));
	}

	/** @throws NotFoundException the share points at something that is gone */
	private function node(IShare $share): Node {
		try {
			return $share->getNode();
		} catch (NotFoundException) {
			throw new NotFoundException('Share not found');
		}
	}

	private function contains(Node $node, int $fileId): bool {
		if ($node instanceof Folder) {
			return $node->getById($fileId) !== [];
		}
		return $node->getId() === $fileId;
	}

	private function flag(IShare $share, string $key, bool $fallback): bool {
		$value = $share->getAttributes()?->getAttribute(self::SCOPE, $key);
		return $value === null ? $fallback : (bool)$value;
	}
}
