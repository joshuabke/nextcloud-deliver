<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One piece of derived-media work for one Version. One table for the built-in
 * background job and the optional worker, so an external worker can claim rows
 * later without a schema change (ADR 0003).
 *
 * @method string getKind()
 * @method void setKind(string $kind)
 * @method int getVersionId()
 * @method void setVersionId(int $versionId)
 * @method string getState()
 * @method void setState(string $state)
 * @method int getProgress()
 * @method void setProgress(int $progress)
 * @method int getAttempts()
 * @method void setAttempts(int $attempts)
 * @method ?string getClaimedBy()
 * @method void setClaimedBy(?string $claimedBy)
 * @method ?string getStderrTail()
 * @method void setStderrTail(?string $stderrTail)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 * @method ?int getStartedAt()
 * @method void setStartedAt(?int $startedAt)
 * @method ?int getFinishedAt()
 * @method void setFinishedAt(?int $finishedAt)
 */
class Job extends Entity {
	public const KIND_PROBE = 'probe';
	public const KIND_PROXY = 'proxy';
	public const KIND_THUMBS = 'thumbs';
	public const KIND_WAVEFORM = 'waveform';

	public const STATE_QUEUED = 'queued';
	public const STATE_RUNNING = 'running';
	public const STATE_DONE = 'done';
	public const STATE_FAILED = 'failed';

	protected ?string $kind = null;
	protected int $versionId = 0;
	protected string $state = self::STATE_QUEUED;
	protected int $progress = 0;
	protected int $attempts = 0;
	protected ?string $claimedBy = null;
	protected ?string $stderrTail = null;
	protected ?int $createdAt = null;
	protected ?int $startedAt = null;
	protected ?int $finishedAt = null;

	public function __construct() {
		$this->addType('versionId', 'integer');
		$this->addType('progress', 'integer');
		$this->addType('attempts', 'integer');
		$this->addType('createdAt', 'integer');
		$this->addType('startedAt', 'integer');
		$this->addType('finishedAt', 'integer');
	}
}
