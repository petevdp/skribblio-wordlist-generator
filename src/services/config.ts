import { logger } from './logger';
import { readFileSync } from 'fs';
import JSON5 from 'json5';
import * as t from 'io-ts';
import { options } from './cli';

export const ConfigCodec = t.type({
  exampleConfigValue: t.string,
});

export type Config = t.TypeOf<typeof ConfigCodec>;
export let config: Config;

export function setupConfig() {
  let configRaw: any = {};
  const textBlob = readFileSync(options.config, 'utf-8');
  if (textBlob) {
    configRaw = { ...JSON5.parse(textBlob) };
  }

  let decoded = ConfigCodec.decode(configRaw);

  if (decoded._tag === 'Left') {
    for (let error of decoded.left) {
      const path = error.context.map(node => node.key).join('/');
      logger.warn(`Invalid config value at ${path}: (actual: ${(error.value as any)?.toString()}, expected: ${error.context[error.context.length - 1].type.name})`);
    }
    throw new Error('Invalid config! see above warnings for details');
  } else {
    config = configRaw;
    logger.info('Succesfully parsed config file');
  }
}
