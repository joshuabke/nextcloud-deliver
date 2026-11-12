<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\AssetMapper;
use OCA\Deliver\Db\Version;
use OCP\IConfig;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * The mail that a Version needs its Proxy made in a browser (the notification
 * always comes). A Member turns it off in their settings; it is on by default.
 */
class BrowserPassMail {
	/** The Member's setting: '1' mails, '0' does not */
	public const SETTING = 'browser_pass_mail';

	public function __construct(
		private IConfig $config,
		private AssetMapper $assets,
		private IMailer $mailer,
		private IUserManager $users,
		private IFactory $l10n,
		private IURLGenerator $urls,
		private LoggerInterface $logger,
	) {
	}

	public function enabled(string $uid): bool {
		return $this->config->getUserValue($uid, Application::APP_ID, self::SETTING, '1') === '1';
	}

	public function setEnabled(string $uid, bool $enabled): void {
		$this->config->setUserValue($uid, Application::APP_ID, self::SETTING, $enabled ? '1' : '0');
	}

	/**
	 * ponytail: sent in the request, one by one; move to a job if Projects get many Managers
	 *
	 * @param list<string> $uids the Managers told by the notification
	 */
	public function needed(Version $version, array $uids): void {
		if (!ReviewerMail::configured($this->config)) {
			return;
		}
		$asset = $this->assets->find($version->getAssetId());
		$name = $asset === null ? $version->getName() : ($asset->getNameOverride() ?? VersionNaming::assetName($version->getName()));
		$link = $this->urls->linkToRouteAbsolute('deliver.page.indexversion', ['id' => $version->getId()]);
		foreach ($uids as $uid) {
			$user = $this->users->get($uid);
			$address = $user?->getEMailAddress();
			if ($user === null || $address === null || $address === '' || !$this->enabled($uid)) {
				continue;
			}
			$l = $this->l10n->get(Application::APP_ID, $this->l10n->getUserLanguage($user));
			$subject = strtr($l->t('{asset}, Version {number}, needs its Proxy made in a browser'), ['{asset}' => $name, '{number}' => (string)$version->getNumber()]);
			$template = $this->mailer->createEMailTemplate('deliver.browserpass', []);
			$template->setSubject($subject);
			$template->addHeader();
			$template->addHeading($subject);
			$template->addBodyText($l->t('Deliver has no ffmpeg on this server, and this video does not play in browsers as it is. Open it in a browser and choose "Make missing derived media in this browser" in its menu, so that it can be reviewed. The browser needs the file on hand, and the tab has to stay open until it is done.'));
			$template->addBodyButton($l->t('Open the Version'), $link);
			$template->addFooter('', $l->getLanguageCode());
			try {
				$message = $this->mailer->createMessage();
				$message->setTo([$address => $user->getDisplayName()]);
				$message->useTemplate($template);
				$this->mailer->send($message);
			} catch (\Throwable $e) {
				$this->logger->warning('Deliver could not mail a Manager', ['exception' => $e]);
			}
		}
	}
}
