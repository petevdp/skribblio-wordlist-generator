import { setupLogger } from './services/logger';
import * as tg from 'type-guards';
import { setupEnvironment } from './services/environment';
import { cliOptions, setupCli } from './services/cli';
import { scrapeAllChildren } from './scrape';
import commonWords from './common-words.json';


import { firstValueFrom } from 'rxjs';
import { filter, map, mergeMap, take, toArray, skip } from 'rxjs/operators';

import nlp from 'compromise';

const commonWordsSet = new Set(commonWords);

export function main() {
  setupEnvironment();
  setupCli();
  setupLogger();
  (async () => {
    await extractNouns(new URL(cliOptions.url));
  })();
}

const ALPHA = /^[A-Za-z']+$/;

async function extractNouns(url: URL) {
  let phrase$ = scrapeAllChildren(url);

  let seenPhrases = new Set<string>();
  const noun$ = phrase$.pipe(
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
    filter(word => word.length > 3),
    filter(word => !commonWordsSet.has(word)),
    toArray(),
    mergeMap(words => {
      const countMap = new Map<string, number>();
      for (let word of words) {
        const currCount = countMap.get(word);
        if (tg.isUndefined(currCount)) countMap.set(word, 1);
        else countMap.set(word, currCount + 1);
      }
      return [...countMap.entries()]
        .sort(([aWord, aCount], [bWord, bCount]) => bCount - aCount)
        .map(([word]) => word);
    }),
    skip(cliOptions.skipNthCommon),
    take(cliOptions.wordCount)
  );
  const allNouns = await firstValueFrom(noun$.pipe(toArray()));
  process.stdout.write(allNouns.join(', '));
}

