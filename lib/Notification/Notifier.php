<?php

declare(strict_types=1);

namespace OCA\Deliver\Notification;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Service\NotificationService;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;

/** Turns Deliver's notifications into text, in the recipient's language */
class Notifier implements INotifier {
	public function __construct(
		private IFactory $l10n,
		private IURLGenerator $urls,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l10n->get(Application::APP_ID)->t('Deliver');
	}

	public function prepare(INotification $notification, string $languageCode): INotification {
		if ($notification->getApp() !== Application::APP_ID) {
			throw new UnknownNotificationException();
		}
		$l = $this->l10n->get(Application::APP_ID, $languageCode);
		$p = $notification->getSubjectParameters();
		$where = ['{asset}' => $p['asset'] ?? '', '{number}' => $p['number'] ?? ''];
		$subject = match ($notification->getSubject()) {
			NotificationService::COMMENT => $l->t('{author} commented on {asset}, Version {number}'),
			NotificationService::REPLY => $l->t('{author} replied on {asset}, Version {number}'),
			NotificationService::VERSION => $l->t('New Version {number} of {asset}'),
			NotificationService::AUTO_STACK => $l->t('{file} was stacked as Version {number} of {asset}, going by its name'),
			NotificationService::MISSING => $l->t('The file of {asset}, Version {number}, is missing'),
			NotificationService::DUE_TOMORROW => $l->t('{asset} is due tomorrow'),
			NotificationService::DUE_TODAY => $l->t('{asset} is due today'),
			NotificationService::MENTION => $l->t('{author} mentioned you on {asset}, Version {number}'),
			NotificationService::APPROVED => $l->t('{author} approved {asset}, Version {number}'),
			NotificationService::CHANGES => $l->t('{author} requested changes on {asset}, Version {number}'),
			default => throw new UnknownNotificationException(),
		};
		$notification->setParsedSubject(strtr($subject, $where + [
			'{author}' => $p['author'] ?? '',
			'{file}' => $p['file'] ?? '',
		]));
		if (($p['body'] ?? '') !== '') {
			$notification->setParsedMessage($p['body']);
		}
		$notification->setLink($this->urls->linkToRouteAbsolute('deliver.page.index') . 'versions/' . ($p['versionId'] ?? ''));
		$notification->setIcon($this->urls->getAbsoluteURL($this->urls->imagePath(Application::APP_ID, 'app-dark.svg')));
		return $notification;
	}
}
