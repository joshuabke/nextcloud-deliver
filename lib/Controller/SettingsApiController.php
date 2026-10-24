<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\Contacts;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** A Member's own Deliver settings (story 144) */
class SettingsApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private Contacts $contacts,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function show(): Response {
		return $this->guard(fn () => $this->contacts->settings());
	}

	#[NoAdminRequired]
	public function update(string $addressBook): Response {
		return $this->guard(function () use ($addressBook) {
			$this->contacts->pick($addressBook);
			return $this->contacts->settings();
		});
	}
}
