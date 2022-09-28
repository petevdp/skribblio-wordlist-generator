import {
  BehaviorSubject,
  combineLatest,
  firstValueFrom,
  from,
  Observable,
  ObservableInput,
  Subject,
  Subscription
} from 'rxjs';
import { flattenDeferred } from './asyncUtils';
import { filter, map, mergeMap, share } from 'rxjs/operators';
import { Disposable } from './disposable';

type Id = {};

class Queue {
  private elements: Record<string, Id>;
  private head = 0;
  private tail = 0;

  constructor() {
    this.elements = {};
  }

  enqueue(id: {}) {
    this.elements[this.tail] = id;
    this.tail++;
    return this;
  }

  dequeue() {
    const item = this.elements[this.head];
    delete this.elements[this.head];
    this.head++;
    return item;
  }

  peek() {
    return this.elements[this.head];
  }

  get length() {
    return this.tail - this.head;
  }

  get isEmpty() {
    return this.length === 0;
  }
}


const totalActive$ = new BehaviorSubject(0);

// totalActive$.subscribe((total) => {
//   console.log('totalActive: ', total);
// });

export class TaskQueue implements Disposable {
  queue$ = new BehaviorSubject<Queue>(new Queue());
  completed$ = new Subject<Id>();
  active$ = new BehaviorSubject<Set<Id>>(new Set());
  sub = new Subscription();

  constructor(maxSize: number) {
    this.sub.add(this.queue$);
    this.sub.add(this.active$);
    this.sub.add(this.completed$);

    this.sub.add(combineLatest([this.queue$, this.active$]).subscribe({
        next: ([queue, active]) => {
          if (active.size < maxSize && queue.length > 0) {
            active.add(queue.dequeue());
            this.queue$.next(queue);
            this.active$.next(active);
          }
        }
      }
    ));

    let prevSize = this.active$.value.size;
    this.sub.add(this.active$.subscribe(active => {
      const diff = active.size - prevSize;
      prevSize = active.size;
      if (diff !== 0) totalActive$.next(totalActive$.value + diff);
    }));

    this.sub.add(this.completed$
      .pipe(
        map(completedId => {
          this.active$.value.delete(completedId);
          return this.active$.value;
        })
      ).subscribe(this.active$));
  }

  async enqueue() {
    const id: Id = {};
    this.queue$.next(this.queue$.value.enqueue(id));
    await firstValueFrom(this.active$.pipe(filter(active => active.has(id))));
    return {
      complete: () => {
        this.completed$.next(id);
      }
    };
  }

  enqueueTask<T>(task: () => ObservableInput<T>): Observable<T> {
    return flattenDeferred(this.enqueue().then(({ complete }) => {
      const task$ = from(task()).pipe(share());
      this.sub.add(task$.subscribe({
        complete: () => complete()
      }));
      return task$;
    }));
  }

  get empty() {
    return this.active$.value.size + this.queue$.value.length === 0;
  }

  dispose() {
    this.sub.unsubscribe();
  }
}

export function queuedMerge<T, O>(queue: TaskQueue, task: (elt: T) => ObservableInput<O>) {
  return (o: Observable<T>) => {
    return o.pipe(mergeMap((elt) => queue.enqueueTask(() => task(elt))));
  };
}
