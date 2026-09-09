import { useEffect, useState } from "react";
import { usePreferences, useSavePreferences } from "../features/chat/chat-hooks";
import { useAuth } from "../features/auth/auth";

export function useSidebarCollapsed() {
  const { profile } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "1");
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();

  useEffect(() => {
    if (prefs.data && profile) {
      const key = `sidebar-collapsed-${profile.username}`;
      const stored = localStorage.getItem(key);
      if (stored !== null) setCollapsed(stored === "1");
      else if (typeof prefs.data.sidebarCollapsed === "boolean") setCollapsed(prefs.data.sidebarCollapsed);
    }
  }, [prefs.data, profile]);

  function setCollapsedPersist(v: boolean) {
    setCollapsed(v);
    try {
      localStorage.setItem("sidebar-collapsed", v ? "1" : "0");
      if (profile) localStorage.setItem(`sidebar-collapsed-${profile.username}`, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    savePrefs.mutate({ sidebarCollapsed: v });
  }

  return { collapsed, setCollapsed, setCollapsedPersist, prefs, profile };
}
