import { BehaviorSubject, firstValueFrom, Observable, Subject } from 'rxjs';
import { JSDOM } from 'jsdom';
import PagePool from 'puppeteer-page-pool';
import * as O from 'fp-ts/Option';
import {
  filter,
  finalize,
  map,
  mergeAll,
  mergeMap,
  scan,
  skipWhile,
  startWith,
  takeUntil
} from 'rxjs/operators';
import { Page } from 'puppeteer';
import { flattenDeferred } from './lib/asyncUtils';
import { defaultLogger, LoggerWithMeta } from './services/logger';
import fetch from 'node-fetch';
import { cliOptions } from './services/cli';
import { pipe } from 'fp-ts/function';
import { TaskQueue } from './lib/queue';

let logger: typeof defaultLogger;

//region Types
type ScrapeTask = {
  url: string;
  taskPath: string[];
}
type Extractor<T, E extends Element> = { selector: string; transform: (e: NodeListOf<E>) => T }

type PageScrapeResult = {
  hrefs: string[];
  phrases: string[];
}

type Scraper = (url: URL) => Promise<O.Option<PageScrapeResult>>;

//endregion

//region Globals
const pagePool = new PagePool({ poolOptions: { max: 15 } });
const Node = new JSDOM('').window.Node;
const PHRASE_EXTRACTOR: Extractor<string[], HTMLElement> = {
  selector: 'body *',
  transform: function extractWords(elts) {
    function nodeListToArray<T extends Node>(list: NodeListOf<T>) {
      // @ts-ignore
      return [...list] as T[];
    }

    const filteredTags = [
      'SCRIPT',
      'NOSCRIPT',
      'LINK',
      'STYLE'
    ];
    // @ts-ignore
    const words = nodeListToArray(elts)
      .filter(elt => !filteredTags.includes(elt.tagName))
      .map(elt => nodeListToArray(elt.childNodes))
      .filter(childNodes => childNodes.some(n => n.nodeType === Node.TEXT_NODE))
      .map(childNodes => childNodes.map(n => n.nodeValue)).flat()
      .filter(phrase => !!phrase) as string[];
    return words;
  }
};
const HREF_EXTRACTOR: Extractor<string[], HTMLAnchorElement> = {
  selector: 'a',
  transform: function extractHrefs(elts: NodeListOf<HTMLAnchorElement>) {
    function nodeListToArray<T extends Node>(list: NodeListOf<T>) {
      // @ts-ignore
      return [...list] as T[];
    }

    return nodeListToArray(elts)
      .filter(a => !!a.href)
      .map(a => {
        try {
          return new URL(a.href);
        } catch (err) {
          return null;
        }
      })
      .filter(url => !!url)
      .map(url => url!.toString());
  }
};
let scrapePage: Scraper;

//endregion

export function scrapeAllChildrenForPhrases(pageUrl: URL): Observable<string> {
  return flattenDeferred((async () => {
    const tasks$ = new Subject<ScrapeTask>();
    const activeTaskCount$ = new BehaviorSubject(0);
    const redirectedUrl = await fetch(pageUrl).then(res => {
      return new URL(res.url);
    });
    const visitedLinks = new Set<string>();

    const pageLimitReached$ = tasks$.pipe(
      scan((taskCount, _) => taskCount + 1, 0),
      skipWhile(count => count < cliOptions.maxPages)
    );

    const phrase$ = tasks$.pipe(
      takeUntil(pageLimitReached$),
      finalize(() => tasks$.complete()),
      startWith<ScrapeTask>({ url: pageUrl.toString(), taskPath: [] }),
      mergeMap(async (task): Promise<O.Option<string[]>> => {
        activeTaskCount$.next(activeTaskCount$.value + 1);
        try {
          logger.info(`scraping ${task.url}`);
          const res = await scrapePage(new URL(task.url));
          if (O.isNone(res)) return O.none;
          const childLinks = res.value.hrefs
            .map(href => new URL(href))
            .filter(url => url.hostname === redirectedUrl.hostname)
            .filter(url => url.pathname !== redirectedUrl.pathname)
            .filter(url => url.pathname.startsWith(redirectedUrl.pathname));

          logger.debug(`found ${res.value.phrases.length} phrases, ${res.value.hrefs.length} hrefs at ${task.url}`);

          if (childLinks.length === 0 && activeTaskCount$.value === 1) {
            logger.info('Ran out of links to search, winding down');
            tasks$.complete();
            activeTaskCount$.complete();
          }

          for (let url of childLinks) {
            if (visitedLinks.has(url.toString())) continue;
            visitedLinks.add(url.toString());
            tasks$.next({
              url: url.toString(),
              taskPath: [...task.taskPath, task.url]
            });
          }
          return pipe(res, O.map(res => res.phrases));
        } finally {
          activeTaskCount$.next(activeTaskCount$.value - 1);
        }
      }),
      filter(O.isSome),
      map(o => o.value),
      mergeAll()
    );
    return phrase$;
  })());
}


export async function setupScraper() {
  logger = defaultLogger.child({ context: 'scraper' });
  if (!cliOptions.static) await pagePool.launch();
  scrapePage = buildScraper();
}

function buildScraper(): Scraper {
  let scraper: Scraper;
  if (cliOptions.static) {
    const fetchQueue = new TaskQueue(20);
    scraper = async (url: URL): Promise<O.Option<PageScrapeResult>> => {
      logger.info(`fetching content from ${url.toString()}`);
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`Error while fetching ${res.url}: (${res.statusText})`);
        return O.none;
      }
      let dom: any;
      try {
        const text = await res.text();
        dom = new JSDOM(text);
      } catch (err) {
        logger.warn(`Error while parsing ${res.url}: (${res.statusText})`, err);
        return O.none;
      }

      const words = pipe(
        dom.window.document.querySelectorAll(PHRASE_EXTRACTOR.selector),
        PHRASE_EXTRACTOR.transform
      );
      const hrefs = pipe(
        dom.window.document.querySelectorAll(HREF_EXTRACTOR.selector),
        HREF_EXTRACTOR.transform
      );

      return O.some({
        phrases: words,
        hrefs: hrefs
      });
    };
    scraper = (url) => firstValueFrom(fetchQueue.enqueueTask(() => scraper(url)));
  } else {
    logger.info('using dynamic scraper');
    scraper = async (url: URL) => {
      let out: PageScrapeResult;
      await pagePool.process(async (page: Page) => {
        await page.goto(url.toString());
        const phrases = page.$$eval(PHRASE_EXTRACTOR.selector, PHRASE_EXTRACTOR.transform as unknown as (elts: Element[]) => string[]);
        const hrefs = page.$$eval(HREF_EXTRACTOR.selector, HREF_EXTRACTOR.transform as unknown as (elts: Element[]) => string[]);
        out = {
          phrases: await phrases,
          hrefs: await hrefs
        };
      });

      return O.some(out!);
    };
  }

  return (url) => {
    return scraper(url);
  };
}
