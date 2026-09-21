import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

type PushPayload = {
  title?: string;
  body?: string;
  href?: string;
  tag?: string;
};

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data: PushPayload = {};
      try {
        data = (event.data?.json() as PushPayload) ?? {};
      } catch {
        data = { title: "Boueres e Fonteles", body: event.data?.text() ?? "" };
      }

      const title = data.title?.trim() || "Boueres e Fonteles";
      const body = data.body?.trim() || "";
      const href = data.href?.trim() || "/";
      const tag = data.tag?.trim() || `painel-${Date.now()}`;

      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = clientsList.some((c) => c.visibilityState === "visible" && c.focused);
      // Aba focada: Realtime + toast já notificam — evita duplicar no SO
      if (focused) return;

      await self.registration.showNotification(title, {
        body,
        tag,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { href },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href =
    (event.notification.data as { href?: string } | undefined)?.href?.trim() ||
    "/";
  const url = new URL(href, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await (client as WindowClient).navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
