import { createContext, useContext, useEffect, useState } from 'react';
import { bootWarehouse } from '../lib/warehouse';

type Status = { state: 'booting'; message: string } | { state: 'ready' } | { state: 'error'; message: string };

const Ctx = createContext<Status>({ state: 'booting', message: 'Starting…' });

export function WarehouseProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>({ state: 'booting', message: 'Starting DuckDB…' });
  useEffect(() => {
    let live = true;
    bootWarehouse((m) => live && m !== 'Ready' && setStatus({ state: 'booting', message: m }))
      .then(() => live && setStatus({ state: 'ready' }))
      .catch((e: Error) => live && setStatus({ state: 'error', message: e.message }));
    return () => {
      live = false;
    };
  }, []);
  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}

export function useWarehouse() {
  return useContext(Ctx);
}

/** Renders children once the warehouse is ready; a quiet loading strip until then. */
export function NeedsWarehouse({ children, label = 'the warehouse' }: { children: React.ReactNode; label?: string }) {
  const s = useWarehouse();
  if (s.state === 'ready') return <>{children}</>;
  if (s.state === 'error')
    return (
      <div role="alert" className="border border-bad bg-bad-soft p-4 text-sm text-bad">
        <p className="font-semibold">The in-browser warehouse could not start.</p>
        <p className="mt-1 whitespace-pre-wrap">{s.message}</p>
        <p className="mt-2 text-ink-2">Reload the page. If it keeps failing, try a recent Chrome, Edge, Firefox or Safari — DuckDB needs WebAssembly and Web Workers.</p>
      </div>
    );
  return (
    <div className="border border-line bg-surface p-4" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">Loading {label}</span>
        <span className="text-ink-3">{s.message}</span>
      </div>
      <div className="skeleton mt-3 h-2 w-full" />
    </div>
  );
}
