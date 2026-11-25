import { migrateLegacyViews, type SavedView, type ViewDraft } from "@/shared/saved-view-model";

type ViewState = {
  read: () => SavedView[];
  write: (views: SavedView[]) => void;
};

/** Persistence owns HTTP, migration and optimistic write ordering; navigation stays with the caller. */
export function savedViewClient(
  state: ViewState,
  legacyKey: () => string,
  storage: Pick<Storage, "getItem" | "setItem">,
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  async function viewRequest<T>(path = "", method = "GET", body?: unknown): Promise<T> {
    const response = await request(`/api/views${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Could not ${method === "GET" ? "load" : "save"} views (${response.status})`,
      );
    return response.status === 204 ? (undefined as T) : response.json();
  }
  async function load(migrate = false) {
    if (migrate) {
      const key = legacyKey();
      const marker = `${key}:imported`;
      if (storage.getItem(marker) !== "1") {
        try {
          const legacy = migrateLegacyViews(storage.getItem(key));
          // Nothing saved in this browser before the server kept views: there is nothing to import, so starting needs no write.
          if (legacy.length) await viewRequest("/import", "POST", legacy);
          // Retain the old source as a backup; never overwrite it with server state.
          storage.setItem(marker, "1");
        } catch (error) {
          // A failed import is retried on the next start; it must not keep the app from loading the views the server has.
          console.warn(error);
        }
      }
    }
    return viewRequest<SavedView[]>();
  }
  const viewWrites = new Map<string, Promise<unknown>>();
  async function update(id: string, patch: Partial<ViewDraft>): Promise<string> {
    const old = state.read().find((v) => v.id === id);
    if (!old) throw new Error("View not found");
    const optimistic = { ...old, ...patch, id };
    state.write(state.read().map((v) => (v.id === id ? optimistic : v)));
    const request = (viewWrites.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => viewRequest<SavedView>(`/${encodeURIComponent(id)}`, "PUT", patch));
    viewWrites.set(id, request);
    try {
      const view = await request;
      state.write(state.read().map((v) => (v === optimistic ? view : v)));
      return id;
    } catch (e) {
      state.write(state.read().map((v) => (v === optimistic ? old : v)));
      throw e;
    } finally {
      if (viewWrites.get(id) === request) viewWrites.delete(id);
    }
  }

  async function refresh(): Promise<SavedView[] | undefined> {
    const views = await load();
    // A focus read must not replace a display edit still being saved.
    if (viewWrites.size) return;
    return views;
  }
  async function create(draft: ViewDraft): Promise<SavedView> {
    const { sourceId: _source, ...definition } = draft;
    const view = await viewRequest<SavedView>("", "POST", definition);
    return view;
  }
  async function remove(id: string): Promise<void> {
    await viewRequest(`/${encodeURIComponent(id)}`, "DELETE");
  }
  return { load, refresh, create, update, remove };
}
