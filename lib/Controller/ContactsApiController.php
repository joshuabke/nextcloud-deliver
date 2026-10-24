<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\Contacts;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;

/** The Member's contacts, for inviting Reviewers (#66) */
class ContactsApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private Contacts $contacts,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(string $search = ''): Response {
		return $this->guard(fn () => $this->contacts->search($search));
	}
}
