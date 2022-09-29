import { setupLogger, defaultLogger } from './services/logger';
import _ from 'lodash';
import * as tg from 'type-guards';
import { setupEnvironment } from './services/environment';
import { cliOptions, setupCli } from './services/cli';
import { scrapeAllChildrenForPhrases, setupScraper } from './scrape';
import commonWords from './common-words.json';


import { firstValueFrom, Observable } from 'rxjs';
import {
  filter,
  map,
  mergeMap,
  take,
  toArray,
  skip,
  scan,
  last
} from 'rxjs/operators';

import nlp from 'compromise';

const commonWordsSet = new Set(commonWords);

export async function main() {
  setupEnvironment();
  setupCli();
  setupLogger();
  await setupScraper();
  await extractNouns(new URL(cliOptions.url));
}


async function extractNouns(url: URL) {
  const logger = defaultLogger.child({ context: 'extractNouns' });
  const ALPHA = /^[A-Za-z']+$/;

  let phrase$ = scrapeAllChildrenForPhrases(url);
  let seenPhrases = new Set<string>();
  const output$: Observable<string> = phrase$.pipe(
    map(phrase => phrase.toLowerCase()),
    //TODO: we could do something more sophisticated here to detect and trim down highly similar phrases, maybe a levenshtein distance threshold?
    filter(phrase => (phrase.split(/\s/).length > 5)),
    filter(phrase => {
      if (seenPhrases.has(phrase)) return false;
      seenPhrases.add(phrase);
      return true;
    }),
    map((phrase) => {
        const doc = nlp(phrase);
        doc.contractions().expand();
        return doc
          .compute('root')
          .match('#Noun');
      }
    ),
    map(view => view.not('#Number').not('#Money').not('#Pronoun').not('#Person')),
    mergeMap(view => view.json()
      .map((word: any) => word.terms[0].root || word.terms[0].normal) as string[]
    ),
    filter(word => !!word.match(ALPHA)),
    filter(word => word.length >= cliOptions.minWordLength),
    filter(word => !commonWordsSet.has(word)),
    scan((countMap, word) => {
      const currCount = countMap.get(word);
      if (tg.isUndefined(currCount)) countMap.set(word, 1);
      else countMap.set(word, currCount + 1);
      return countMap;
    }, new Map<string, number>),
    last(),
    mergeMap((countMap) => [...countMap.entries()]
      .sort(([aWord, aCount], [bWord, bCount]) => bCount - aCount)
    ),
    map(([word]): string => word as string),
    skip(cliOptions.skipNthCommon),
    take(cliOptions.wordCount),
    toArray(),
    map((arr: string[]): string[] => cliOptions.randomize ? _.shuffle(arr) : arr),
    map((arr: string[]) => arr.join(cliOptions.separator))
  ) as Observable<string>;
  let allNouns = await firstValueFrom(output$);
  process.stdout.write(allNouns + '\n');
}

