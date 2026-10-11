/**
 * This browser's alert subscription, kept in IndexedDB (not in cookies or `localStorage`) because
 * the service worker needs the management token to confirm receipts, and service workers can
 * only read IndexedDB. Used by the page and the service worker; no DOM APIs here.
 */
export interface StoredSubscription {
  readonly subscriptionId: string;
  readonly managementToken: string;
  readonly pointCode: string;
  readonly routeCode: string;
}

export interface SubscriptionStore {
  load(): Promise<StoredSubscription | null>;
  save(subscription: StoredSubscription): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'ruta-limpia';
const DB_VERSION = 1;
const STORE = 'subscription';
const KEY = 'current';

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function run<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDatabase(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    });
  } finally {
    db.close();
  }
}

export function createSubscriptionStore(factory: IDBFactory): SubscriptionStore {
  return {
    async load() {
      const value = await run<unknown>(factory, 'readonly', (store) => store.get(KEY));
      return isStoredSubscription(value) ? value : null;
    },
    async save(subscription) {
      await run(factory, 'readwrite', (store) => store.put(subscription, KEY));
    },
    async clear() {
      await run(factory, 'readwrite', (store) => store.delete(KEY));
    },
  };
}

function isStoredSubscription(value: unknown): value is StoredSubscription {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['subscriptionId', 'managementToken', 'pointCode', 'routeCode'].every(
    (key) => typeof v[key] === 'string',
  );
}
