import { useCallback, useEffect, useState } from "react";

export interface ApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Keeps same-URL data while reloading and hides responses/errors from other URLs. */
export function useApi<T>(url: string | null): ApiResult<T> {
  const [result, setResult] = useState<{ url: string; data: T } | null>(null);
  const [request, setRequest] = useState<{ url: string | null; nonce: number; loading: boolean; error: string | null }>({ url, nonce: 0, loading: Boolean(url), error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!url) {
      setRequest({ url, nonce, loading: false, error: null });
      return;
    }
    const ac = new AbortController();
    setRequest({ url, nonce, loading: true, error: null });
    fetch(url, { signal: ac.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.json() as T;
      })
      .then(data => {
        if (!ac.signal.aborted) setResult({ url, data });
      })
      .catch((error: unknown) => {
        if (ac.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setRequest({ url, nonce, loading: false, error: String(error) });
      })
      .finally(() => {
        if (!ac.signal.aborted) setRequest(current => ({ ...current, loading: false }));
      });
    return () => ac.abort();
  }, [url, nonce]);

  const currentRequest = request.url === url && request.nonce === nonce;
  return {
    data: url && result?.url === url ? result.data : null,
    loading: Boolean(url) && (!currentRequest || request.loading),
    error: url && currentRequest ? request.error : null,
    reload,
  };
}
