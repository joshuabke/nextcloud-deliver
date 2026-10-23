<?php

declare(strict_types=1);

namespace OCA\Deliver\Service;

use OCA\Deliver\AppInfo\Application;
use OCA\Deliver\Db\Reviewer;
use OCA\Deliver\Db\ReviewerMapper;
use OCP\Config\IUserConfig;
use OCP\Constants;
use OCP\Contacts\IManager;
use OCP\IAddressBook;
use OCP\IAddressBookEnabled;

/**
 * The logged-in Member's address books, as a source of Reviewers' names and
 * addresses (#66). A contact is never tied to a Reviewer (ADR 0013). Only the
 * Member's own and shared address books count, never the instance's users.
 */
class Contacts {
	/** Leaves out the system address book: instance users become Members, not Reviewers */
	private const OWN_BOOKS = ['enumeration' => false, 'fullmatch' => false];
	/** The user setting naming the address book Reviewers are saved to */
	private const SETTING = 'address_book';

	public function __construct(
		private IManager $manager,
		private ReviewerMapper $reviewers,
		private IUserConfig $config,
		private ?string $userId,
	) {
	}

	/**
	 * Contacts whose name or address matches, one row per address, those
	 * without one left out, with the URL of their picture if they have one.
	 *
	 * @return list<array{name: string, email: string, photo: ?string}>
	 */
	public function search(string $term): array {
		$term = trim($term);
		if ($term === '') {
			return [];
		}
		$rows = [];
		foreach ($this->manager->search($term, ['FN', 'EMAIL'], self::OWN_BOOKS + ['limit' => 20]) as $contact) {
			$name = (string)($contact['FN'] ?? '');
			// Nextcloud hands a contact's picture out as a CardDAV URL behind this prefix
			$photo = isset($contact['PHOTO']) ? preg_replace('/^VALUE=uri:/', '', (string)$contact['PHOTO']) : null;
			foreach ((array)($contact['EMAIL'] ?? []) as $email) {
				// Found by one address, the contact's others are no match
				if (mb_stripos($name, $term) !== false || mb_stripos((string)$email, $term) !== false) {
					$rows[] = ['name' => $name !== '' ? $name : (string)$email, 'email' => (string)$email, 'photo' => $photo];
				}
			}
		}
		return $rows;
	}

	/**
	 * Checks once whether each Reviewer's address is in the Member's address
	 * books, and keeps the answer; one added or deleted by hand later does not
	 * change it, Save to Contacts does.
	 *
	 * @param list<Reviewer> $reviewers of the logged-in Member
	 */
	public function checkContacts(array $reviewers): void {
		foreach ($reviewers as $reviewer) {
			$email = $reviewer->getEmail();
			if ($email !== null && $reviewer->getInContacts() === null) {
				$reviewer->setInContacts($this->has($email));
				$this->reviewers->update($reviewer);
			}
		}
	}

	/**
	 * Saves the Reviewer's name and address as a contact, unless the address
	 * is in the Member's address books already.
	 *
	 * @return bool whether a contact was made
	 * @throws InvalidRequestException they have no address, or the Member no address book to write to
	 */
	public function save(Reviewer $reviewer): bool {
		$email = $reviewer->getEmail() ?? throw new InvalidRequestException('A Reviewer without an address cannot be saved to Contacts');
		$saved = false;
		if (!$this->has($email)) {
			$book = $this->target() ?? throw new InvalidRequestException('There is no address book to save to');
			$book->createOrUpdate(['FN' => (string)$reviewer->getName(), 'EMAIL' => $email]);
			$saved = true;
		}
		$reviewer->setInContacts(true);
		$this->reviewers->update($reviewer);
		return $saved;
	}

	/** Whether a contact in the Member's address books has this address, whatever its case */
	private function has(string $email): bool {
		foreach ($this->manager->search($email, ['EMAIL'], self::OWN_BOOKS) as $contact) {
			foreach ((array)($contact['EMAIL'] ?? []) as $each) {
				if (mb_strtolower((string)$each) === mb_strtolower($email)) {
					return true;
				}
			}
		}
		return false;
	}

	/** @return array<string, IAddressBook> the Member's address books they can add contacts to, by key */
	private function writable(): array {
		$books = [];
		foreach ($this->manager->getUserAddressBooks() as $book) {
			$enabled = !$book instanceof IAddressBookEnabled || $book->isEnabled();
			if ($enabled && !$book->isSystemAddressBook() && ($book->getPermissions() & Constants::PERMISSION_CREATE)) {
				$books[(string)$book->getKey()] = $book;
			}
		}
		return $books;
	}

	/** The address book Reviewers are saved to: the Member's pick while it stands, else their Contacts */
	private function target(): ?IAddressBook {
		$books = $this->writable();
		$picked = $this->config->getValueString((string)$this->userId, Application::APP_ID, self::SETTING);
		foreach ($books as $book) {
			if ($book->getUri() === 'contacts' && !$book->isShared()) {
				$default = $book;
			}
		}
		return $books[$picked] ?? $default ?? null;
	}

	/** @return array{addressBook: ?string, addressBooks: list<array{key: string, name: string}>} the Member's settings (story 144) */
	public function settings(): array {
		$target = $this->target();
		return [
			'addressBook' => $target === null ? null : (string)$target->getKey(),
			'addressBooks' => array_values(array_map(
				static fn (IAddressBook $book) => ['key' => (string)$book->getKey(), 'name' => (string)$book->getDisplayName()],
				$this->writable(),
			)),
		];
	}

	/** @throws InvalidRequestException not an address book the Member can write to */
	public function pick(string $key): void {
		if (!isset($this->writable()[$key])) {
			throw new InvalidRequestException('Not an address book you can save to');
		}
		$this->config->setValueString((string)$this->userId, Application::APP_ID, self::SETTING, $key);
	}
}
