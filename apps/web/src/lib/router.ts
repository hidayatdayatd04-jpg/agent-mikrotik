import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "login" }
  | { name: "chat-new" }
  | { name: "chat"; id: string }
  | { name: "network-map"; id?: string }
  | { name: "monitoring"; id?: string }
  | { name: "notifications" }
  | { name: "backups"; id?: string }
  | { name: "settings"; section: string };

const SETTINGS_SECTIONS = new Set([
  "connectors",
  "providers",
  "web-search",
  "profile",
  "appearance",
  "context",
  "security",
  "archive",
  "about",
  "help",
]);

export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/login") return { name: "login" };
  if (path === "/network-map") return { name: "network-map" };
  const mapMatch = path.match(/^\/network-map\/([^/]+)$/);
  if (mapMatch) return { name: "network-map", id: decodeURIComponent(mapMatch[1]!) };

  if (path === "/monitoring") return { name: "monitoring" };
  const monMatch = path.match(/^\/monitoring\/([^/]+)$/);
  if (monMatch) return { name: "monitoring", id: decodeURIComponent(monMatch[1]!) };

  if (path === "/notifications") return { name: "notifications" };

  if (path === "/backups") return { name: "backups" };
  const backupMatch = path.match(/^\/backups\/([^/]+)$/);
  if (backupMatch) return { name: "backups", id: decodeURIComponent(backupMatch[1]!) };

  if (path === "/chat" || path === "/") return { name: "chat-new" };
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) return { name: "chat", id: decodeURIComponent(chatMatch[1]!) };
  if (path === "/settings") return { name: "settings", section: "connectors" };
  const setMatch = path.match(/^\/settings\/([^/]+)$/);
  if (setMatch) {
    const section = setMatch[1]!;
    return { name: "settings", section: SETTINGS_SECTIONS.has(section) ? section : "connectors" };
  }
  return { name: "chat-new" };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case "login":
      return "/login";
    case "chat-new":
      return "/chat";
    case "chat":
      return `/chat/${encodeURIComponent(route.id)}`;
    case "settings":
      return `/settings/${route.section}`;
    case "network-map":
      return route.id ? `/network-map/${encodeURIComponent(route.id)}` : "/network-map";
    case "monitoring":
      return route.id ? `/monitoring/${encodeURIComponent(route.id)}` : "/monitoring";
    case "notifications":
      return "/notifications";
    case "backups":
      return route.id ? `/backups/${encodeURIComponent(route.id)}` : "/backups";
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const path = routePath(route);
  if (window.location.pathname === path) return;
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

export function useNavigate() {
  return useCallback((route: Route, opts?: { replace?: boolean }) => navigate(route, opts), []);
}
