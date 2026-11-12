<?php

declare(strict_types=1);

namespace OCA\Deliver\Controller;

use OCA\Deliver\Service\BrowserPassMail;
use OCA\Deliver\Service\Contacts;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/** A Member's own Deliver settings (story 144) */
class SettingsApiController extends OCSController {
	use GuardsErrors;

	public function __construct(
		string $appName,
		IRequest $request,
		private Contacts $contacts,
		private BrowserPassMail $browserPassMail,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function show(): Response {
		return $this->guard(fn () => $this->settings());
	}

	#[NoAdminRequired]
	public function browserPassMail(bool $enabled): Response {
		return $this->guard(function () use ($enabled) {
			$this->browserPassMail->setEnabled((string)$this->userSession->getUser()?->getUID(), $enabled);
			return $this->settings();
		});
	}

	/** @return array{addressBook: ?string, addressBooks: list<array{key: string, name: string}>, browserPassMail: bool} */
	private function settings(): array {
		return $this->contacts->settings() + ['browserPassMail' => $this->browserPassMail->enabled((string)$this->userSession->getUser()?->getUID())];
	}

	#[NoAdminRequired]
	public function update(string $addressBook): Response {
		return $this->guard(function () use ($addressBook) {
			$this->contacts->pick($addressBook);
			return $this->contacts->settings();
		});
	}
}
