import { logger, ppObj, setupLogger } from './services/logger';
import { setupEnvironment } from './services/environment';
import { setupCli } from './services/cli';
import { config, setupConfig } from './services/config';

export function main() {
  setupEnvironment();
  setupCli();
  setupLogger();
  setupConfig();


  logger.info(ppObj(config));
}

