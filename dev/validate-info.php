<?php
$doc = new DOMDocument();
$doc->load(__DIR__ . '/../appinfo/info.xml');
libxml_use_internal_errors(true);
$ok = $doc->schemaValidate(__DIR__ . '/info.xsd');
echo $ok ? "info.xml: valid against the App Store schema\n" : "info.xml: INVALID\n";
foreach (libxml_get_errors() as $e) {
	echo '  - ' . trim($e->message) . "\n";
}
