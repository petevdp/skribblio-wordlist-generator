import { program } from 'commander';
import * as t from 'io-ts';


const OptionsCodec = t.type({
  'config': t.string
});

type Options = t.TypeOf<typeof OptionsCodec>;

export let options: Options;

export function setupCli() {
  program
    .option('--config', 'path of configuration file', './config.json5');

  program.parse();

  let opts = program.opts();
  const decoded = OptionsCodec.decode(opts);

  if (decoded._tag === 'Left') {
    for (let error of decoded.left) {
      const path = error.context.map(node => node.key).join('/');
      console.warn(`Invalid option: ${path}: (actual: ${(error.value as any)?.toString()}, expected: ${error.context[error.context.length - 1].type.name})`);
    }
    throw new Error('Invalid options! see above warnings for details');
  }
  options = opts as Options;
}


