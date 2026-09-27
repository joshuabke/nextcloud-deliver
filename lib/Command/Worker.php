<?php

declare(strict_types=1);

namespace OCA\Deliver\Command;

use OCA\Deliver\Service\JobRunner;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/** Works through the derived-media queue without waiting for cron */
class Worker extends Command {
	public function __construct(
		private JobRunner $runner,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('deliver:worker')
			->setDescription('Generate Proxies, Thumbnail Strips and Waveforms as they are queued')
			->addOption('once', null, InputOption::VALUE_NONE, 'Stop when the queue is empty')
			->addOption('sleep', null, InputOption::VALUE_REQUIRED, 'Seconds to wait when the queue is empty', '5');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$name = 'occ:' . gethostname() . ':' . (int)getmypid();
		$sleep = max(1, (int)$input->getOption('sleep'));
		while (true) {
			if ($this->runner->runNext($name)) {
				$output->writeln('<info>ran a job</info>', OutputInterface::VERBOSITY_VERBOSE);
			} elseif ($input->getOption('once')) {
				return self::SUCCESS;
			} else {
				sleep($sleep);
			}
		}
	}
}
