.PHONY: up down enable occ build composer lint-php fix-php test-integration package appinfo

COMPOSE = docker compose
OCC = $(COMPOSE) exec -u www-data nextcloud php occ

# Dev instance: http://localhost:8080, admin / adminadmin123
up:
	$(COMPOSE) up -d --build
	@until $(OCC) status 2>/dev/null | grep -q 'installed: true'; do echo "waiting for Nextcloud install…"; sleep 5; done
	# The image's entrypoint writes config.php until it hands over to Apache;
	# settings made before that can be overwritten, so wait for Apache to answer
	@until $(COMPOSE) exec -T nextcloud php -r 'exit(@file_get_contents("http://localhost/status.php") === false ? 1 : 0);'; do echo "waiting for Apache…"; sleep 2; done
	$(OCC) app:disable firstrunwizard
	# Integration tests knock on invalid link tokens on purpose; the
	# bruteforce protection would answer 429 from the tenth knock on. Reset first:
	# resetting is itself a no-op once the protection is off.
	$(OCC) security:bruteforce:reset 127.0.0.1
	$(OCC) config:system:set auth.bruteforce.protection.enabled --value false --type boolean
	# They also name many Reviewers from one address, past the rate limit of a link
	$(OCC) config:system:set ratelimit.protection.enabled --value false --type boolean
	# Mail goes to the Mailpit container, never out
	$(OCC) config:system:set mail_smtpmode --value smtp
	$(OCC) config:system:set mail_smtphost --value mail
	$(OCC) config:system:set mail_smtpport --value 1025 --type integer
	$(OCC) config:system:set mail_from_address --value deliver
	$(OCC) config:system:set mail_domain --value example.test
	$(MAKE) enable

down:
	$(COMPOSE) down

enable:
	$(OCC) app:enable deliver

# Usage: make occ ARGS="deliver:something"
occ:
	$(OCC) $(ARGS)

build:
	npm ci
	npm run build

# PHP dev dependencies (PHPUnit) without a local PHP: vendor/ is gitignored
composer:
	docker run --rm -u $(shell id -u):$(shell id -g) -v $(CURDIR):/app -w /app composer:2 install

# Coding standard and Psalm, as CI runs them, in a throwaway PHP container
PHP = docker run --rm -u $(shell id -u):$(shell id -g) -v $(CURDIR):/app -w /app php:8.3-cli php -d memory_limit=2G
lint-php: composer
	$(PHP) vendor/bin/php-cs-fixer fix --dry-run --diff
	$(PHP) vendor/bin/psalm --no-cache --threads=4

fix-php: composer
	$(PHP) vendor/bin/php-cs-fixer fix

# PHPUnit integration tests run inside the Nextcloud container against its own HTTP API
test-integration: composer
	$(COMPOSE) exec -u www-data nextcloud php custom_apps/deliver/vendor/bin/phpunit -c custom_apps/deliver/phpunit.xml

# What the App Store gets: the built app, nothing of the workshop around it.
# The archive holds one folder named after the app id, as the store requires.
PACKAGE_CONTENT = appinfo lib templates img js css l10n LICENSE README.md CHANGELOG.md CHANGELOG.de.md

package: build
	rm -rf build/deliver build/deliver.tar.gz
	mkdir -p build/deliver
	for path in $(PACKAGE_CONTENT); do \
		test -e $$path && cp -r $$path build/deliver/ || true; \
	done
	# Source maps help nobody on a production instance and double the size
	find build/deliver -name '*.map' -delete
	tar -czf build/deliver.tar.gz -C build deliver
	@echo "build/deliver.tar.gz"
	@tar -tzf build/deliver.tar.gz | sed -n '1,12p'

# Checks appinfo/info.xml against the App Store schema (dev/info.xsd)
appinfo:
	$(COMPOSE) exec -u www-data nextcloud php custom_apps/deliver/dev/validate-info.php
