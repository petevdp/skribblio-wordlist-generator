import { Observable, Subject } from 'rxjs';
import PagePool from 'puppeteer-page-pool';
import {
  filter,
  mergeAll,
  startWith,
  finalize,
  scan,
  mergeMap,
  skipWhile,
  takeUntil
} from 'rxjs/operators';
import puppeteer, { Browser, Page } from 'puppeteer';
import { flattenDeferred, withMutable } from './lib/asyncUtils';
import { queuedMerge, TaskQueue } from './lib/queue';
import { logger } from './services/logger';
import fetch from 'node-fetch';
import { Pool } from './lib/pool';
import { cliOptions } from './services/cli';


type ScrapeTask = {
  url: string;
  taskPath: string[];
}

let browser: Browser;


const scrapeQueue = new TaskQueue(10);

export function scrapeAllChildren(pageUrl: URL): Observable<string> {
  return flattenDeferred((async () => {
    const tasks$ = new Subject<ScrapeTask>();
    const redirectedUrl = await fetch(pageUrl).then(res => {
      return new URL(res.url);
    });
    await setupScrape();

    tasks$.subscribe({
      complete: () => {
        cleanupScrape();
      }
    });

    const pageLimitReached$ = tasks$.pipe(
      scan((taskCount, _) => taskCount + 1, 0),
      skipWhile(count => count < cliOptions.maxPages)
    );

    const phrase = tasks$.pipe(
      takeUntil(pageLimitReached$),
      finalize(() => tasks$.complete()),
      startWith<ScrapeTask>({ url: pageUrl.toString(), taskPath: [] }),
      withMutable(() => [new Set<string>()]),
      mergeMap(async ([task, visitedLinks]) => {
        const res = await scrapePage(task.url);
        const childLinks = res.pageLinks
          .filter(url => url.hostname === redirectedUrl.hostname)
          .filter(url => url.pathname !== redirectedUrl.pathname)
          .filter(url => url.pathname.startsWith(redirectedUrl.pathname));

        if (childLinks.length === 0 && scrapeQueue.empty) {
          tasks$.complete();
        }

        for (let url of childLinks) {
          if (visitedLinks.has(url.toString())) continue;
          visitedLinks.add(url.toString());
          tasks$.next({
            url: url.toString(),
            taskPath: [...task.taskPath, task.url]
          });
        }
        return res.phrases;
      }),
      mergeAll()
    );
    return phrase;
  })());
}

type PageScrapeResult = {
  pageLinks: URL[];
  phrases: string[];
}

const pagePool = new PagePool({
      poolOptions: {
        max: 15,
      }
    }
  )
;

async function scrapePage(pageUrl: string): Promise<PageScrapeResult> {
  let out: PageScrapeResult;
  await pagePool.process(async (page: Page) => {
    logger.info(`scraping ${pageUrl}`);
    await page.goto(pageUrl);
    const words: Promise<string[]> = page.$$eval(
      'body *',
      (elts) => {
        const filteredTags = [
          'SCRIPT',
          'NOSCRIPT',
          'LINK',
          'STYLE'
        ];
        const words = elts
          .filter(elt => !filteredTags.includes(elt.tagName))
          // @ts-ignore
          .filter(elt => [...elt.childNodes].some(n => n.nodeType === Node.TEXT_NODE))
          // @ts-ignore
          .map(elt => [...elt.childNodes].map(n => n.nodeValue)).flat()
          .filter(phrase => !!phrase);
        return words;
      }
    );


    const links: Promise<string[]> = page.$$eval(
      'a',
      (elts) => {
        return elts
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
    ) as Promise<string[]>;

    out = {
      phrases: await words,
      pageLinks: (await links).map(href => new URL(href))
    };

    logger.debug(`found ${out.phrases.length} at ${pageUrl}.`);
  });
  return out!;
}

const puppeteerArgs = [
  '--disable-crash-reporter',
  '--disable-dev-profile',
  '--disable-gpu',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-offer-upload-credit-cards',
  '--disable-password-generation',
  '--disable-setuid-sandbox',
  '--disable-speech-api',
  '--disable-suggestions-ui',
  '--disable-web-security',
  '--enable-async-dns',
  '--enable-tcp-fast-open',
  // Hide scrollbars from screenshots.
  '--hide-scrollbars',
  '--no-default-browser-check',
  '--no-experiments',
  '--no-pings',
  '--no-sandbox',
  '--no-zygote',
  '--prerender-from-omnibox=disabled'
];

async function setupScrape() {
  await pagePool.launch();
}

function cleanupScrape() {
  pagePool.destroy();
}

