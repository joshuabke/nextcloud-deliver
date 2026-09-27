<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One file as one iteration of an Asset. Media metadata counts Frames: the
 * frame rate is a fraction, start timecode and duration are Frame counts.
 *
 * @method int getProjectId()
 * @method void setProjectId(int $projectId)
 * @method int getAssetId()
 * @method void setAssetId(int $assetId)
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method int getNumber()
 * @method void setNumber(int $number)
 * @method string getName()
 * @method void setName(string $name)
 * @method ?int getFpsNum()
 * @method ?int getFpsDen()
 * @method void setHasVideo(bool $hasVideo)
 * @method ?bool getHasVideo()
 * @method void setHasAudio(bool $hasAudio)
 * @method ?bool getHasAudio()
 * @method void setFpsNum(int $fpsNum)
 * @method void setFpsDen(int $fpsDen)
 * @method void setWidth(int $width)
 * @method void setHeight(int $height)
 * @method ?int getWidth()
 * @method ?int getHeight()
 * @method void setDurationFrames(int $durationFrames)
 * @method ?int getDurationFrames()
 * @method void setStartFrame(int $startFrame)
 * @method ?int getStartFrame()
 * @method void setDropFrame(bool $dropFrame)
 * @method ?bool getDropFrame()
 * @method string getProxyState()
 * @method void setProxyState(string $proxyState)
 * @method string getThumbsState()
 * @method void setThumbsState(string $thumbsState)
 * @method string getWaveformState()
 * @method void setWaveformState(string $waveformState)
 * @method ?string getDerivedError()
 * @method void setDerivedError(?string $derivedError)
 * @method ?bool getPlayable()
 * @method void setPlayable(bool $playable)
 * @method ?bool getAutoStacked()
 * @method void setAutoStacked(bool $autoStacked)
 * @method string getState()
 * @method void setState(string $state)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $createdAt)
 */
class Version extends Entity {
	public const STATE_READY = 'ready';
	public const STATE_MISSING = 'missing';

	protected int $projectId = 0;
	protected int $assetId = 0;
	protected int $fileId = 0;
	protected ?int $number = null;
	/** Filename at the last scan, so a Missing Version still has a name */
	protected ?string $name = null;
	protected ?int $fpsNum = null;
	protected ?int $fpsDen = null;
	protected ?bool $dropFrame = false;
	protected ?int $startFrame = null;
	protected ?int $durationFrames = null;
	protected ?int $width = null;
	protected ?int $height = null;
	protected ?bool $hasVideo = false;
	protected ?bool $hasAudio = false;
	protected string $state = self::STATE_READY;
	/** Whether browsers play the original; null until ffprobe has looked */
	protected ?bool $playable = null;
	/** Set when the filename convention stacked this Version, so a Member can undo it */
	protected ?bool $autoStacked = null;
	protected string $proxyState = 'none';
	protected string $thumbsState = 'none';
	protected string $waveformState = 'none';
	protected ?string $derivedError = null;
	protected int $createdAt = 0;

	public function __construct() {
		$this->addType('projectId', 'integer');
		$this->addType('assetId', 'integer');
		$this->addType('fileId', 'integer');
		$this->addType('number', 'integer');
		$this->addType('fpsNum', 'integer');
		$this->addType('fpsDen', 'integer');
		$this->addType('dropFrame', 'boolean');
		$this->addType('autoStacked', 'boolean');
		$this->addType('playable', 'boolean');
		$this->addType('startFrame', 'integer');
		$this->addType('durationFrames', 'integer');
		$this->addType('width', 'integer');
		$this->addType('height', 'integer');
		$this->addType('hasVideo', 'boolean');
		$this->addType('hasAudio', 'boolean');
		$this->addType('createdAt', 'integer');
	}
}
