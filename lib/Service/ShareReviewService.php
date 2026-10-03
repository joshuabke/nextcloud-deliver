<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\Db\Asset;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\LinkActivityMapper;
use OCA\Deliver\Db\Version;
use OCA\Deliver\Db\VersionMapper;
use OCP\Constants;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\HintException;
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
	public const FLAG_LATEST = 'latest';

	public function __construct(
		private IShareManager $shares,
		private IRootFolder $root,
		private AssetMapper $assets,
		private VersionMapper $versions,
		private IURLGenerator $urls,
		private IConfig $config,
		private LinkActivityMapper $activity,
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

	/** @return array{review: bool, canComment: bool, allowOlder: bool, watermark: bool, canDownload: bool, latestOnly: bool} */
	public function flags(IShare $share): array {
		return [
			'review' => $this->isReview($share),
			'canComment' => $this->flag($share, self::FLAG_COMMENT, true),
			'allowOlder' => $this->flag($share, self::FLAG_OLDER, false),
			// The Reviewer's name over the picture (story 94)
			'watermark' => $this->flag($share, self::FLAG_WATERMARK, false),
			'canDownload' => $share->canSeeContent() && !$share->getHideDownload(),
			'latestOnly' => $this->flag($share, self::FLAG_LATEST, false),
		];
	}

	/**
	 * Sets the flags that are given and leaves the rest of the share alone.
	 *
	 * @throws AccessDeniedException the user may not change this share
	 */
	public function setFlags(
		string $uid,
		int $shareId,
		?bool $review,
		?bool $canComment,
		?bool $allowOlder,
		?bool $watermark = null,
		?bool $latestOnly = null,
		?bool $canDownload = null,
		?string $description = null,
	): IShare {
		$share = $this->ownShare($uid, $shareId);
		$attributes = $share->getAttributes() ?? $share->newAttributes();
		foreach ([self::FLAG_REVIEW => $review, self::FLAG_COMMENT => $canComment, self::FLAG_OLDER => $allowOlder, self::FLAG_WATERMARK => $watermark, self::FLAG_LATEST => $latestOnly] as $key => $value) {
			if ($value !== null) {
				$attributes->setAttribute(self::SCOPE, $key, $value);
			}
		}
		$share->setAttributes($attributes);
		if ($canDownload !== null) {
			$share->setHideDownload(!$canDownload);
		}
		if ($description !== null) {
			// The share's own note, which Nextcloud shows on its page too
			$share->setNote($description);
		}
		return $this->shares->updateShare($share);
	}

	/**
	 * A Share Link the user may change, for what both kinds of link do alike.
	 *
	 * @throws NotFoundException|AccessDeniedException
	 */
	public function ownLink(string $uid, int $shareId): ShareReviewLink {
		return $this->wrap($this->ownShare($uid, $shareId));
	}

	public function wrap(IShare $share): ShareReviewLink {
		return new ShareReviewLink($share, $this, $this->shares);
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
	 * The user's Share Links that belong to a Project: on its folder,
	 * anything inside it, or one of its files (ADR 0009), never a folder
	 * that merely holds one of its files, for the Project's navigation
	 * (story 100). A link names its file or folder and the folder Files
	 * shows it in.
	 *
	 * @param ?Folder $folder a Folder Project's folder, as the user reaches it
	 * @param list<int> $fileIds the Project's files the user can open
	 * @return list<array<string, mixed>>
	 */
	public function linksUnder(string $uid, ?Folder $folder, array $fileIds): array {
		// Nextcloud no longer looks into subfolders for us: take all of the user's links, keep those that show the Project
		// ponytail: one node lookup per link and file of the user; filter by path in SQL if people keep thousands
		$shares = $this->shares->getSharesBy($uid, IShare::TYPE_LINK, null, true, -1);
		$home = $this->root->getUserFolder($uid);
		$files = array_filter(array_map(static fn (int $id) => $home->getFirstNodeById($id), $fileIds));
		$links = [];
		foreach ($shares as $share) {
			$node = $home->getFirstNodeById($share->getNodeId());
			if ($node === null || !$this->shows($node, $folder, $files)) {
				continue;
			}
			$links[] = $this->serialize($share) + [
				'fileId' => $node->getId(),
				'name' => $node->getName(),
				'isProject' => $folder !== null && $node->getId() === $folder->getId(),
				'mimeType' => $node->getMimetype(),
				'dir' => $home->getRelativePath($node->getParent()->getPath()) ?? '/',
			];
		}
		return $links;
	}

	/**
	 * Whether a shared node belongs to the Project
	 *
	 * @param list<Node> $files
	 */
	private function shows(Node $node, ?Folder $folder, array $files): bool {
		if ($folder !== null && ($node->getId() === $folder->getId() || str_starts_with($node->getPath(), $folder->getPath() . '/'))) {
			return true;
		}
		// A folder that merely holds one of the files belongs to whatever else it holds, not to this Project
		foreach ($files as $file) {
			if ($file->getId() === $node->getId()) {
				return true;
			}
		}
		return false;
	}

	/**
	 * A new Share Link with review already on (story 45).
	 *
	 * @throws AccessDeniedException the node is read-only for the user
	 */
	public function createLink(string $uid, int $fileId): array {
		$node = $this->userNode($uid, $fileId);
		ProjectService::assertWritable($node);
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
	 * Password and expiry of a Share Link, as Nextcloud's own link settings
	 * set them and under the same sharing policy; '' removes either.
	 *
	 * @throws InvalidRequestException the date is none, or the sharing policy refuses it
	 */
	public function protect(string $uid, int $shareId, ?string $password, ?string $expireDate): void {
		$share = $this->ownShare($uid, $shareId);
		if ($password !== null) {
			$share->setPassword($password === '' ? null : $password);
		}
		if ($expireDate !== null) {
			$date = $expireDate === '' ? null : \DateTime::createFromFormat('!Y-m-d', $expireDate);
			if ($date === false) {
				throw new InvalidRequestException('The expiry is a date such as 2026-12-31');
			}
			$share->setExpirationDate($date);
		}
		try {
			$this->shares->updateShare($share);
		} catch (HintException $e) {
			throw new InvalidRequestException($e->getHint());
		} catch (\InvalidArgumentException $e) {
			throw new InvalidRequestException($e->getMessage());
		}
	}

	/** Deletes the Share Link from Nextcloud: it stops working for everyone, Personal Links through it too; its activity goes with it */
	public function deleteLink(string $uid, int $shareId): void {
		$share = $this->ownShare($uid, $shareId);
		$this->shares->deleteShare($share);
		$this->activity->deleteByToken($share->getToken());
	}

	/** The nearest review Share Link of a Member from a file up to their home, for mails */
	public function reviewShareFor(string $owner, int $fileId): ?IShare {
		$home = $this->root->getUserFolder($owner);
		for ($node = $home->getFirstNodeById($fileId); $node !== null; $node = $node->getPath() === $home->getPath() ? null : $node->getParent()) {
			foreach ($this->shares->getSharesBy($owner, IShare::TYPE_LINK, $node, true, -1) as $share) {
				if ($this->isReview($share)) {
					return $share;
				}
			}
		}
		return null;
	}

	/**
	 * A path on the instance's own address (overwrite.cli.url), for mails:
	 * the request that sent one may have come in through localhost or an IP.
	 */
	public function instanceUrl(string $path): string {
		$base = parse_url($this->config->getSystemValueString('overwrite.cli.url'));
		if (!isset($base['scheme'], $base['host'])) {
			return $this->urls->getAbsoluteURL($path);
		}
		return $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '') . $path;
	}

	public function shareUrl(IShare $share): string {
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
		ProjectService::assertWritable($this->userNode($uid, $share->getNodeId()));
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

	public function serialize(IShare $share): array {
		return [
			'id' => (int)$share->getId(),
			'token' => $share->getToken(),
			'url' => $this->shareUrl($share),
			'kind' => 'share',
			'label' => $share->getLabel(),
			'description' => $share->getNote() === '' ? null : $share->getNote(),
			'hasPassword' => $share->getPassword() !== null,
			'expireDate' => $share->getExpirationDate()?->format('Y-m-d'),
			// Whether Reviewers can be mailed about Replies at all (story 66)
			'canMail' => ReviewerMail::configured($this->config),
		] + $this->flags($share);
	}

	/**
	 * The Assets this Share Link shows, whatever their Project (ADR 0009),
	 * each with its Versions inside the shared node, highest Version Number
	 * first.
	 * ponytail: walks the shared folder on every call; keep a file index if shares get big
	 *
	 * @return array<int, array{asset: Asset, versions: Version[]}>
	 */
	public function assets(IShare $share): array {
		$node = $this->node($share);
		$fileIds = $node instanceof Folder ? $this->fileIdsUnder($node) : [$node->getId()];
		$byAsset = [];
		foreach ($this->versions->findByFiles($fileIds) as $version) {
			$byAsset[$version->getAssetId()][] = $version;
		}
		$result = [];
		foreach ($this->assets->findByIds(array_keys($byAsset)) as $asset) {
			$result[$asset->getId()] = ['asset' => $asset, 'versions' => $byAsset[$asset->getId()]];
		}
		return $result;
	}

	/** @return list<int> the media files under a folder, at any depth */
	private function fileIdsUnder(Folder $folder): array {
		$ids = [];
		foreach ($folder->getDirectoryListing() as $node) {
			if ($node instanceof Folder) {
				array_push($ids, ...$this->fileIdsUnder($node));
			} elseif ($node instanceof File && Reviewable::file($node)) {
				$ids[] = $node->getId();
			}
		}
		return $ids;
	}

	/** The original through the share's public WebDAV, which serves ranges; null when it is not inside the share */
	public function mediaUrl(IShare $share, Version $version): ?string {
		$node = $this->node($share);
		if ($node instanceof File) {
			return $node->getId() === $version->getFileId()
				? $this->urls->getAbsoluteURL('/public.php/dav/files/' . $share->getToken())
				: null;
		}
		$found = $node instanceof Folder ? $node->getFirstNodeById($version->getFileId()) : null;
		if ($found === null) {
			return null;
		}
		$relative = substr($found->getPath(), strlen($node->getPath()));
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

	public function containsFile(IShare $share, int $fileId): bool {
		return $this->contains($this->node($share), $fileId);
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
