<?php

declare(strict_types=1);

require_once './vendor/autoload.php';

use Nextcloud\CodingStandard\Config;

$config = new Config();
$config
	->getFinder()
	->in(['appinfo', 'lib', 'tests'])
	->notPath('e2e');
return $config;
