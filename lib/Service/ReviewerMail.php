<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Comment;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Db\Version;
use OCP\IConfig;
use OCP\L10N\IFactory;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * An email to a Reviewer who gave an address, when someone replies to their
 * Comment (story 65). Nothing else is ever mailed to them.
 */
class ReviewerMail {
	public function __construct(
		private IMailer $mailer,
		private IConfig $config,
		private IFactory $l10n,
		private CommentMapper $comments,
		private ReviewerMapper $reviewers,
		private ShareReviewService $sharing,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Whether the instance can send mail at all (story 66).
	 * ponytail: a sender address counts as configured; a wrong SMTP host only shows when sending fails
	 */
	public static function configured(IConfig $config): bool {
		return $config->getSystemValueString('mail_smtpmode', 'smtp') !== 'null'
			&& $config->getSystemValueString('mail_from_address') !== '';
	}

	/** Mails the Reply to the Reviewer who wrote the Comment it answers; a failure is logged, never thrown */
	public function replied(Comment $reply, Version $version, string $author): void {
		$parent = $reply->getParentId() === null ? null : $this->comments->find($reply->getParentId());
		$reviewer = $parent?->getReviewerId() === null ? null : $this->reviewers->find((int)$parent->getReviewerId());
		$email = $reviewer?->getEmail();
		if ($reviewer === null || $email === null || $reply->getReviewerId() === $reviewer->getId() || !self::configured($this->config)) {
			return;
		}
		$l = $this->l10n->get(Application::APP_ID);
		$link = $this->sharing->personalLinkFor($version, $reviewer);
		$template = $this->mailer->createEMailTemplate('deliver.ReviewerReply', ['version' => $version->getId()]);
		$template->setSubject($l->t('%s replied to your Comment', [$author]));
		$template->addHeader();
		$template->addHeading($l->t('%s replied to your Comment on %s', [$author, $version->getName()]));
		$template->addBodyText($l->t('Your Comment:') . ' ' . (string)$parent?->getBody());
		$template->addBodyText($author . ': ' . $reply->getBody());
		if ($link !== null) {
			$template->addBodyButton($l->t('Open the review'), $link);
		}
		$template->addFooter();
		try {
			$message = $this->mailer->createMessage();
			$message->setTo([$email => $reviewer->getName()]);
			$message->useTemplate($template);
			$this->mailer->send($message);
		} catch (\Throwable $e) {
			$this->logger->warning('Deliver could not mail a Reviewer about a Reply', ['exception' => $e]);
		}
	}
}
