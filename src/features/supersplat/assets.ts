/** Local, cross-project storage for source models and editable documents. */
export interface GaussianAsset { id: string; name: string; sourceName?: string; folderPath?: string; source: Blob; document?: Blob; updatedAt: number }
const DATABASE = 'canvas-gaussian-assets';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    const req = run(tx.objectStore('assets'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? req.error); };
  });
}
export const gaussianAssets = {
  list: () => operation<GaussianAsset[]>('readonly', store => store.getAll()),
  get: (id: string) => operation<GaussianAsset | undefined>('readonly', store => store.get(id)),
  put: (asset: GaussianAsset) => operation<IDBValidKey>('readwrite', store => store.put(asset)),
  remove: (id: string) => operation<undefined>('readwrite', store => store.delete(id)),
};
