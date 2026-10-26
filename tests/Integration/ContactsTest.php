<?php

declare(strict_types=1);

namespace OCA\Deliver\Tests\Integration;

use PHPUnit\Framework\TestCase;

/**
 * Reviewers from Nextcloud Contacts (#66, stories 142–144): the invite form
 * suggests people from the Member's address books, and a Reviewer can be
 * saved into one. A contact only fills in name and address (ADR 0013).
 */
class ContactsTest extends TestCase {
	private NextcloudClient $admin;
	private NextcloudClient $nc;
	private string $uid;
	private int $projectId;

	protected function setUp(): void {
		$this->admin = new NextcloudClient(
			getenv('DELIVER_TEST_URL') ?: 'http://localhost',
			getenv('DELIVER_TEST_USER') ?: 'admin',
			getenv('DELIVER_TEST_PASSWORD') ?: 'adminadmin123',
		);
		// A user of their own, so that their address books start empty and go with them
		$this->uid = 'contacts-' . bin2hex(random_bytes(4));
		$password = 'deliver-' . bin2hex(random_bytes(8));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $this->uid, 'password' => $password]);
		$this->nc = $this->admin->withUser($this->uid, $password);
		$this->nc->mkdir('spot');
		$this->nc->put('spot/cut.mp4', 'not really a video');
		$created = $this->nc->ocs('POST', '/projects', ['folderId' => $this->nc->fileId('spot')]);
		self::assertSame(201, $created['status'], json_encode($created['data']));
		$this->projectId = $created['data']['id'];
	}

	protected function tearDown(): void {
		$this->nc->deleteProject($this->projectId);
		$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/{$this->uid}");
	}

	/** Puts a contact into one of the user's address books, by CardDAV as the Contacts app does */
	private function contact(string $name, array $emails, string $book = 'contacts', bool $photo = false): void {
		$uid = bin2hex(random_bytes(8));
		$card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:$uid\r\nFN:$name\r\n"
			. implode('', array_map(static fn (string $email) => "EMAIL;TYPE=WORK:$email\r\n", $emails))
			// A 1×1 PNG, as the Contacts app stores a picture
			. ($photo ? "PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\r\n" : '')
			. "END:VCARD\r\n";
		$status = $this->nc->request('PUT', "/remote.php/dav/addressbooks/users/{$this->uid}/$book/$uid.vcf", $card, ['Content-Type: text/vcard'])['status'];
		self::assertSame(201, $status, "PUT contact into $book");
	}

	/** @return list<array{name: string, email: string}> */
	private function suggest(string $search): array {
		$found = $this->nc->ocs('GET', '/contacts?search=' . rawurlencode($search));
		self::assertSame(200, $found['status'], json_encode($found['data']));
		return $found['data'];
	}

	public function testTheInviteFormSuggestsContactsWithAnAddress(): void {
		$this->contact('Kim Novak', ['kim@studio.test', 'kim@home.test']);
		$this->contact('Kimberly Nomail', []);

		self::assertSame([
			['name' => 'Kim Novak', 'email' => 'kim@studio.test', 'photo' => null],
			['name' => 'Kim Novak', 'email' => 'kim@home.test', 'photo' => null],
		], $this->suggest('kim'), 'one row per address, none without one');
		self::assertSame(['kim@home.test'], array_column($this->suggest('home.test'), 'email'), 'found by address too');

		$this->contact('Mo Picture', ['mo@studio.test'], photo: true);
		$photo = $this->suggest('mo@')[0]['photo'];
		self::assertStringEndsWith('?photo', (string)$photo, 'a contact\'s picture comes along');
		$fetched = $this->nc->request('GET', (string)parse_url($photo, PHP_URL_PATH) . '?photo');
		self::assertSame([200, "\x89PNG"], [$fetched['status'], substr($fetched['body'], 0, 4)], 'and the Member can load it');

		$colleague = 'colleague-' . bin2hex(random_bytes(4));
		$this->admin->ocsForm('POST', '/ocs/v2.php/cloud/users', ['userid' => $colleague, 'password' => 'deliver-' . bin2hex(random_bytes(8)), 'email' => "$colleague@studio.test"]);
		try {
			self::assertSame([], $this->suggest($colleague), 'never the instance\'s users');
		} finally {
			$this->admin->ocsForm('DELETE', "/ocs/v2.php/cloud/users/$colleague");
		}
	}

	/** @return array<string, ?bool> Reviewer name → whether they are in the Member's contacts, as the Project's navigation lists them */
	private function inContacts(): array {
		$reviewers = $this->nc->ocs('GET', "/projects/{$this->projectId}/links")['data']['reviewers'];
		return array_combine(array_column($reviewers, 'name'), array_column($reviewers, 'inContacts'));
	}

	/** @return array<string, mixed> the new Review Link */
	private function link(): array {
		return $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
	}

	/** @return array{status: int, data: mixed} */
	private function save(int $reviewerId): array {
		return $this->nc->ocs('POST', "/reviewers/$reviewerId/contact");
	}

	public function testAnInvitedReviewerIsSavedToContactsOnce(): void {
		$this->contact('Kim Novak', ['Kim@Studio.test']);
		$link = $this->link();
		$invite = fn (string $name, ?string $email) => $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => $name, 'email' => $email])['data']['id'];
		$invite('Kim', 'kim@studio.test');
		$lee = $invite('Lee', 'lee@studio.test');
		$noa = $invite('Noa', null);

		self::assertSame(['Kim' => true, 'Lee' => false, 'Noa' => null], $this->inContacts(), 'checked on invite, whatever the case of the address');

		$saved = $this->save($lee);
		self::assertSame([201, ['saved' => true]], [$saved['status'], $saved['data']]);
		self::assertSame([['name' => 'Lee', 'email' => 'lee@studio.test', 'photo' => null]], $this->suggest('lee'), 'name and address went in');
		self::assertTrue($this->inContacts()['Lee']);

		$again = $this->save($lee);
		self::assertSame([200, ['saved' => false]], [$again['status'], $again['data']], 'never twice');
		self::assertCount(1, $this->suggest('lee'));

		self::assertSame(400, $this->save($noa)['status'], 'nobody without an address');

		$this->contact('Noa Novak', ['noa@studio.test']);
		$this->nc->ocs('PUT', "/reviewers/$noa", ['name' => 'Noa', 'email' => 'noa@studio.test']);
		self::assertTrue($this->inContacts()['Noa'], 'an address the Member gives is checked');
	}

	public function testAReviewerWhoNamedThemselvesIsCheckedOnTheNextList(): void {
		$this->contact('Kim Novak', ['kim@studio.test']);
		$link = $this->link();
		$visitor = new PublicClient(getenv('DELIVER_TEST_URL') ?: 'http://localhost', $link['token']);
		$named = $visitor->call('POST', '/api/reviewer', ['name' => 'Max', 'email' => 'max@studio.test']);
		self::assertSame(201, $named['status'], json_encode($named['data']));
		self::assertArrayNotHasKey('inContacts', $named['data'], 'a Reviewer never learns what is in the Member\'s contacts');

		self::assertSame(['Max' => false], $this->inContacts());

		$this->contact('Max Hand', ['max@studio.test']);
		self::assertSame(['Max' => false], $this->inContacts(), 'checked once, not on every list');
		self::assertSame(['saved' => false], $this->save($named['data']['id'])['data'], 'added by hand since: nothing is saved twice');

		$visitor->call('PUT', '/api/reviewer', ['email' => 'kim@studio.test']);
		self::assertSame(['Max' => true], $this->inContacts(), 'a new address is checked again');
	}

	/** @return int how many contacts the address book holds */
	private function cards(string $book): int {
		$listed = $this->nc->request('PROPFIND', "/remote.php/dav/addressbooks/users/{$this->uid}/$book/", null, ['Depth: 1']);
		return substr_count($listed['body'], '.vcf</d:href>');
	}

	public function testTheMemberPicksTheAddressBookReviewersAreSavedTo(): void {
		$made = $this->nc->request('MKCOL', "/remote.php/dav/addressbooks/users/{$this->uid}/team/",
			'<?xml version="1.0"?><d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:set><d:prop>'
			. '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Team</d:displayname>'
			. '</d:prop></d:set></d:mkcol>', ['Content-Type: application/xml']);
		self::assertSame(201, $made['status'], $made['body']);

		$settings = $this->nc->ocs('GET', '/settings')['data'];
		$books = array_column($settings['addressBooks'], 'key', 'name');
		self::assertEqualsCanonicalizing(['Contacts', 'Team'], array_keys($books), 'the address books the Member can write to');
		self::assertSame($books['Contacts'], $settings['addressBook'], 'Contacts unless another is picked');

		self::assertSame(400, $this->nc->ocs('PUT', '/settings', ['addressBook' => 'nonsense'])['status']);
		self::assertSame($books['Team'], $this->nc->ocs('PUT', '/settings', ['addressBook' => $books['Team']])['data']['addressBook']);

		$link = $this->nc->ocs('POST', "/projects/{$this->projectId}/links")['data'];
		$kim = $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Kim', 'email' => 'kim@studio.test'])['data']['id'];
		$this->save($kim);
		self::assertSame([1, 0], [$this->cards('team'), $this->cards('contacts')], 'saved where the Member said');

		$this->nc->request('DELETE', "/remote.php/dav/addressbooks/users/{$this->uid}/team/");
		self::assertSame($books['Contacts'], $this->nc->ocs('GET', '/settings')['data']['addressBook'], 'back to Contacts once the picked one is gone');
		$lee = $this->nc->ocs('POST', "/links/{$link['id']}/reviewers", ['name' => 'Lee', 'email' => 'lee@studio.test'])['data']['id'];
		self::assertSame(201, $this->save($lee)['status']);
		self::assertSame(1, $this->cards('contacts'));
	}
}
