import { program } from 'commander';
import * as t from 'io-ts';


const OptionsCodec = t.type({
  url: t.string,
  wordCount: t.number,
  maxPages: t.number,
  outFile: t.union([t.string,t.undefined]),
  skipNthCommon: t.number
});

type Options = t.TypeOf<typeof OptionsCodec>;

export let cliOptions: Options;

export function setupCli() {
  const defaults: Partial<Options> = {
    wordCount: 300,
    maxPages: 50,
    skipNthCommon: 20
  }

  program
    .argument('<url>', 'path to visit')
    .option('-w, --word-count <num>', `number of words to return. default: ${defaults.wordCount}`, parseInt)
    .option('-m, --max-pages <num>', `upper limit for pages to crawl. default: ${defaults.maxPages}`, parseInt)
    .option('-s --skip-nth-common <num>');

  program.parse();

  let opts = program.opts();
  opts = {
    ...defaults,
    ...opts,
    url: program.args[0]
  }
  const decoded = OptionsCodec.decode(opts);

  if (decoded._tag === 'Left') {
    for (let error of decoded.left) {
      const path = error.context.map(node => node.key).join('/');
      console.warn(`Invalid option: ${path}: (actual: ${(error.value as any)?.toString()}, expected: ${error.context[error.context.length - 1].type.name})`);
    }
    throw new Error('Invalid options! see above warnings for details');
  }
  cliOptions = opts as Options;
}


