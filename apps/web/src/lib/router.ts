import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "login" }
  | { name: "chat-new" }
  | { name: "chat"; id: string }
  | { name: "settings"; section: string };

const SETTINGS_SECTIONS = new Set([
  "connectors",
  "providers",
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
