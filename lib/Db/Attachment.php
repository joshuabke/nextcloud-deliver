<?php

declare(strict_types=1);

namespace OCA\Deliver\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A file attached to a Comment. The file sits in app data under the
 * Comment (AttachmentStore); this row names it.
 *
 * @method int getCommentId()
 * @method void setCommentId(int $commentId)
 * @method string getName()
 * @method void setName(string $name)
 * @method string getMimeType()
 * @method void setMimeType(string $mimeType)
 * @method int getSize()
 * @method void setSize(int $size)
 */
class Attachment extends Entity {
	protected int $commentId = 0;
	protected ?string $name = null;
	protected ?string $mimeType = null;
	protected ?int $size = null;

	public function __construct() {
		$this->addType('commentId', 'integer');
		$this->addType('size', 'integer');
	}
}
