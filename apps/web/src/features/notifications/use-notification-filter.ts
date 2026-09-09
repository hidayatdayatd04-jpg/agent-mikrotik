import { useState } from "react";
import type { NotificationDTO } from "@shared/index";

export function useNotificationFilter(items: NotificationDTO[] | undefined) {
  const [filterType, setFilterType] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = (items ?? []).filter((item) => {
    if (unreadOnly && item.read) return false;
    if (filterType !== "all" && item.type !== filterType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        (item.routerLabel?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const unreadCount = (items ?? []).filter((i) => !i.read).length;

  return { filterType, setFilterType, unreadOnly, setUnreadOnly, search, setSearch, filtered, unreadCount };
}
