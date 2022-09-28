import { Disposable } from './disposable';
import { Mutex } from 'async-mutex';
import { TaskQueue } from './queue';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

type Id = {};

export class Pool<T> implements Disposable {
  entities: Map<Id, T> = new Map();
  available: Map<Id, T> = new Map();
  availableChange$ = new Subject<void>();
  mtx = new Mutex();

  constructor(private maxEntities: number, private getNew: () => Promise<T> | T) {
  }


  async runWithAcquired<O>(action: (entity: T) => Promise<O>): Promise<O> {
    let entity: T;
    let id: Id;
    await this.mtx.acquire();
    try {
      if (this.available.size > 0) {
        [id, entity] = this.available.entries().next().value;
        this.available.delete(id);
        this.availableChange$.next();
      } else if (this.entities.size < this.maxEntities) {
        entity = await this.getNew();
        id = {};
        this.entities.set(id, entity);
      } else {
        await firstValueFrom(this.availableChange$.pipe(filter(() => this.available.size > 0)));
        [id, entity] = this.available.entries().next().value;
        this.available.delete(id);
        this.availableChange$.next();
      }
    } finally {
      this.mtx.release();
    }
    const out = await action(entity);
    this.available.set(id, entity);
    this.availableChange$.next();
    return out;
  }

  dispose(): Promise<void> | void {
    this.availableChange$.complete();
  }
}
