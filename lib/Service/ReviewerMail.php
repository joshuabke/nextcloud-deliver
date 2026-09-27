<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Comment;
use OCA\Deliver\Db\CommentMapper;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCA\Deliver\Db\Version;
use OCP\IConfig;
use OCP\L10N\IFactory;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * Emails to Reviewers who gave an address, about what they asked for when
 * naming themselves or later: Replies to their Comments (story 65, on by
 * default), every new Comment, new Versions.
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

	/** Mails the Reply to the Reviewer who wrote the Comment it answers, if they want Replies (story 65) */
	public function replied(Comment $reply, Version $version, string $author): void {
		$parent = $reply->getParentId() === null ? null : $this->comments->find($reply->getParentId());
		$reviewer = $parent?->getReviewerId() === null ? null : $this->reviewers->find((int)$parent->getReviewerId());
		if ($reviewer === null || $reply->getReviewerId() === $reviewer->getId() || !$reviewer->mailWishes()['replies']) {
			return;
		}
		$l = $this->l10n->get(Application::APP_ID);
		$this->send($reviewer, $version, 'deliver.ReviewerReply',
			$l->t('%s replied to your Comment', [$author]),
			$l->t('%s replied to your Comment on %s', [$author, $version->getName()]),
			[$l->t('Your Comment:') . ' ' . (string)$parent?->getBody(), $author . ': ' . $reply->getBody()],
		);
	}

	/**
	 * Mails a new Comment or Reply to the Reviewers who want every Comment,
	 * but not to its author, nor to the one a Reply already reached.
	 */
	public function commented(Comment $comment, Version $version, string $author): void {
		$parent = $comment->getParentId() === null ? null : $this->comments->find($comment->getParentId());
		$l = $this->l10n->get(Application::APP_ID);
		foreach ($this->reviewers->findByProject($version->getProjectId()) as $reviewer) {
			$repliedTo = $parent !== null && $parent->getReviewerId() === $reviewer->getId() && $reviewer->mailWishes()['replies'];
			if ($reviewer->getId() === $comment->getReviewerId() || $repliedTo || !$reviewer->mailWishes()['comments']) {
				continue;
			}
			$this->send($reviewer, $version, 'deliver.ReviewerComment',
				$l->t('%s commented on %s', [$author, $version->getName()]),
				$l->t('%s commented on %s', [$author, $version->getName()]),
				[$author . ': ' . $comment->getBody()],
			);
		}
	}

	/** Mails a new Version to the Reviewers who want to hear of them */
	public function versionArrived(Version $version): void {
		$l = $this->l10n->get(Application::APP_ID);
		foreach ($this->reviewers->findByProject($version->getProjectId()) as $reviewer) {
			if ($reviewer->mailWishes()['versions']) {
				$this->send($reviewer, $version, 'deliver.ReviewerVersion',
					$l->t('Version %s of %s is ready for review', [(string)$version->getNumber(), $version->getName()]),
					$l->t('Version %s of %s is ready for review', [(string)$version->getNumber(), $version->getName()]),
					[],
				);
			}
		}
	}

	/**
	 * One mail to one Reviewer, with a button straight into the Review view.
	 * Only where they gave an address, the instance mails, and a review link
	 * still shows the Version. A failure is logged, never thrown.
	 * ponytail: sent in the request, one by one; move to a job if Projects get many Reviewers
	 *
	 * @param list<string> $paragraphs
	 */
	private function send(Reviewer $reviewer, Version $version, string $kind, string $subject, string $heading, array $paragraphs): void {
		$email = $reviewer->getEmail();
		if ($email === null || !self::configured($this->config)) {
			return;
		}
		$link = $this->sharing->reviewLinkFor($version, $reviewer);
		if ($link === null) {
			return;
		}
		$l = $this->l10n->get(Application::APP_ID);
		$template = $this->mailer->createEMailTemplate($kind, ['version' => $version->getId()]);
		$template->setSubject($subject);
		$template->addHeader();
		$template->addHeading($heading);
		foreach ($paragraphs as $paragraph) {
			$template->addBodyText($paragraph);
		}
		$template->addBodyButton($l->t('Open the review'), $link);
		$template->addBodyText($l->t('You get these mails because you asked for them in the review. The envelope next to the Comments changes that.'));
		$template->addFooter();
		try {
			$message = $this->mailer->createMessage();
			$message->setTo([$email => $reviewer->getName()]);
			$message->useTemplate($template);
			$this->mailer->send($message);
		} catch (\Throwable $e) {
			$this->logger->warning('Deliver could not mail a Reviewer', ['exception' => $e]);
		}
	}
}
