<?php

declare(strict_types=1);

// Runs one of N shards of the integration tests, as CI runs them side by side,
// each against its own Nextcloud: php dev/shard.php 2/3 [more PHPUnit options].
// A test costs about the same whatever it does, its setup being most of it, so
// each test method with all its data sets goes to the shard with the fewest
// tests so far, the methods with the most data sets first. Every shard deals
// the same way, and a new test lands in one of them without a list to keep.

[$k, $n] = array_map('intval', explode('/', $argv[1] ?? '') + [1 => 0]);
if ($n < 1 || $k < 1 || $k > $n) {
	fwrite(STDERR, "Usage: php dev/shard.php K/N [PHPUnit options]\n");
	exit(2);
}
$phpunit = [PHP_BINARY, __DIR__ . '/../vendor/bin/phpunit', '-c', __DIR__ . '/../phpunit.xml', '--testsuite', 'Integration'];
$run = static fn (array $args): string => implode(' ', array_map('escapeshellarg', $args));

exec($run([...$phpunit, '--list-tests']), $lines, $status);
if ($status !== 0) {
	fwrite(STDERR, implode("\n", $lines) . "\n");
	exit($status);
}
$tests = [];
foreach ($lines as $line) {
	if (preg_match('/^ - ([^"]+::\w+)/', $line, $match) === 1) {
		$tests[$match[1]] = ($tests[$match[1]] ?? 0) + 1;
	}
}
arsort($tests);
$loads = array_fill(1, $n, 0);
$mine = [];
foreach ($tests as $test => $cases) {
	$shard = array_search(min($loads), $loads, true);
	$loads[$shard] += $cases;
	if ($shard === $k) {
		$mine[] = preg_quote($test, '/');
	}
}
if ($mine === []) {
	exit(0);
}
passthru($run([...$phpunit, '--filter', '/^(' . implode('|', $mine) . ')( with data set |$)/', ...array_slice($argv, 2)]), $status);
exit($status);
