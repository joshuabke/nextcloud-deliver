<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

/** The request is valid but clashes with the current state: a nested Project, a taken Version Number, a closed older Version */
class ProjectConflictException extends \RuntimeException {
}
