import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "@/components/icons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

function useDark() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
      setDark(true);
    } else if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setDark(false);
    }
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return { dark, toggle };
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { dark, toggle } = useDark();
  if (compact) {
    return (
      <button type="button" onClick={toggle} className="rounded-md p-1.5 text-xs text-muted-foreground hover:text-foreground" aria-label={dark ? "Tema terang" : "Tema gelap"}>
        {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        {dark ? "Terang" : "Gelap"}
      </button>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} className="size-8" aria-label={dark ? "Ganti ke tema terang" : "Ganti ke tema gelap"}>
      {dark ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function ThemeToggleMenuItem() {
  const { dark, toggle } = useDark();
  return (
    <DropdownMenuItem onClick={toggle} className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer">
      {dark ? <Sun className="size-4 text-amber-500" /> : <Moon className="size-4 text-muted-foreground" />}
      <span>{dark ? "Tema Terang" : "Tema Gelap"}</span>
    </DropdownMenuItem>
  );
}
