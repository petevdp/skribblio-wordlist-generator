import { program, Option } from 'commander';
import * as t from 'io-ts';
import unescapeJs from 'unescape-js';
import { pipe } from 'fp-ts/function';
import { formatValidationErrors } from 'io-ts-reporters';
import * as E from 'fp-ts/Either';

const OptionsCodec = t.type({
  url: t.string,
  static: t.boolean,
  wordCount: t.number,
  maxPages: t.number,
  outFile: t.union([t.string, t.undefined]),
  skipNthCommon: t.number,
  minWordLength: t.number,
  randomize: t.boolean,
  separator: t.string,
  searchSpace: t.union([t.literal('child-paths'), t.literal('domain'), t.literal('all')])
});

type Options = t.TypeOf<typeof OptionsCodec>;

export let cliOptions: Options;

export function setupCli() {
  const defaults: Partial<Options> = {
    static: false,
    wordCount: 300,
    maxPages: 50,
    skipNthCommon: 0,
    minWordLength: 3,
    randomize: false,
    separator: ', '
  };

  // noinspection TypeScriptValidateJSTypes
  program
    .argument('<url>', 'path to visit')
    .option('-s, --static', `Only process static content on pages`)
    .option('-w, --word-count <num>', `Number of words to return. default: (${defaults.wordCount})`, parseInt)
    .option('-m, --max-pages <num>', `Upper limit for pages to crawl. default: (${defaults.maxPages})`, parseInt)
    .option('--skip-nth-common <num>', `Skip <num> most common words from output. default: (${defaults.skipNthCommon})`)
    .option('--min-word-length <num>', `Filters any words less than <num> characters long. default: (${defaults.minWordLength})`)
    .option('-r, --randomize', `Randomize order of final output. default: (${defaults.randomize})`)
    .option('--separator <str>', `Provide a custom word separator. example: (\\n) default: (${defaults.separator})`, unescapeJs)
    .addOption(new Option('--search-space <setting>').choices(['child-paths', 'domain', 'all']).default('child-paths'))
  ;

  program.parse();

  let opts = program.opts();
  opts = {
    ...defaults,
    ...opts,
    url: program.args[0]
  };

  const result = pipe(
    opts,
    OptionsCodec.decode,
    E.mapLeft(formatValidationErrors)
  );
  if (E.isLeft(result)) {
    for (let error of result.left) {
      console.warn(error);
    }
    throw new Error('Invalid options! see above warnings for details');
  }
  cliOptions = result.right;
}


