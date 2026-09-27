<?php

declare(strict_types=1);

namespace OCA\Deliver\Command;

use OCA\Deliver\Db\ProjectMapper;
use OCA\Deliver\Db\VersionMapper;
use OCA\Deliver\Service\DerivedMedia;
use OCP\AppFramework\Db\DoesNotExistException;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/** Deletes derived media and queues it again; app data holds nothing that cannot be rebuilt (ADR 0003) */
class Regenerate extends Command {
	public function __construct(
		private ProjectMapper $projects,
		private VersionMapper $versions,
		private DerivedMedia $media,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('deliver:regenerate')
			->setDescription('Delete derived media and generate it again, for one Version, one Project or everything')
			// Not --version: the console application owns that option
			->addOption('project-id', null, InputOption::VALUE_REQUIRED, 'Only this Project')
			->addOption('version-id', null, InputOption::VALUE_REQUIRED, 'Only this Version');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$versionId = $input->getOption('version-id');
		$projectId = $input->getOption('project-id');
		if ($versionId !== null) {
			$versions = array_filter([$this->versions->find((int)$versionId)]);
		} elseif ($projectId !== null) {
			try {
				$versions = $this->versions->findByProject($this->projects->find((int)$projectId)->getId());
			} catch (DoesNotExistException) {
				$versions = [];
			}
		} else {
			$versions = array_merge(...array_values(array_map(
				fn ($project) => $this->versions->findByProject($project->getId()),
				$this->projects->findAll(),
			)));
		}
		if ($versions === [] && ($versionId !== null || $projectId !== null)) {
			$output->writeln('<error>No such Version or Project</error>');
			return self::FAILURE;
		}
		foreach ($versions as $version) {
			$this->media->regenerate($version->getId());
		}
		$output->writeln('<info>queued ' . count($versions) . ' Version(s)</info>');
		return self::SUCCESS;
	}
}
