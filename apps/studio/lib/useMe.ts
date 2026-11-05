'use client';
import { useEffect, useState } from 'react';
import { api, type Entitlements, type Me } from './api';

/** How often the features are checked again when the live stream is not available. */
const POLL_MS = 15_000;

/**
 * The signed-in member, shared by every component on the page (one request, one stream). Their
 * features (set by the super admin) stay live: a server-sent event stream pushes every change, and
 * when it cannot connect they are polled instead. So a feature the super admin removes disappears
 * from the menu without a reload.
 */
let current: Me | null = null;
let started = false;
const listeners = new Set<(me: Me | null) => void>();

function publish(me: Me | null) {
  current = me;
  for (const l of listeners) l(me);
}

function applyEntitlements(ent: Entitlements) {
  if (current && current.entitlements?.version !== ent.version) publish({ ...current, entitlements: ent });
}

function start() {
  if (started) return;
  started = true;
  let poll: ReturnType<typeof setInterval> | undefined;
  const startPolling = () => {
    if (poll) return;
    poll = setInterval(() => void api<Entitlements>('/me/entitlements?surface=web').then(applyEntitlements, () => undefined), POLL_MS);
  };
  api<Me>('/auth/me')
    .then((m) => {
      publish(m);
      if (typeof EventSource === 'undefined') return startPolling();
      const source = new EventSource('/api/me/entitlements/stream?surface=web');
      source.addEventListener('entitlements', (e) => {
        try {
          applyEntitlements(JSON.parse((e as MessageEvent<string>).data) as Entitlements);
        } catch {
          // Ignore a malformed event; the next one replaces it.
        }
      });
      source.onerror = () => {
        source.close();
        startPolling();
      };
    })
    .catch(() => {
      started = false;
    });
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(current);
  useEffect(() => {
    listeners.add(setMe);
    if (current) setMe(current);
    start();
    return () => void listeners.delete(setMe);
  }, []);
  return me;
}
