<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A file attached to a Comment. The file sits in the Project folder; this
 * row only points at it.
 *
 * @method int getCommentId()
 * @method void setCommentId(int $commentId)
 * @method int getFileId()
 * @method void setFileId(int $fileId)
 * @method string getName()
 * @method void setName(string $name)
 * @method string getMimeType()
 * @method void setMimeType(string $mimeType)
 * @method int getSize()
 * @method void setSize(int $size)
 */
class Attachment extends Entity {
	protected int $commentId = 0;
	protected int $fileId = 0;
	protected ?string $name = null;
	protected ?string $mimeType = null;
	protected ?int $size = null;

	public function __construct() {
		$this->addType('commentId', 'integer');
		$this->addType('fileId', 'integer');
		$this->addType('size', 'integer');
	}
}
