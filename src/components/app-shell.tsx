"use client";

import * as React from "react";
import Link from "next/link";
import { Moon, Search, Sun } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

const SearchContext = React.createContext<{ query: string; setQuery: (q: string) => void }>({ query: "", setQuery: () => {} });
export const useGlobalSearch = () => React.useContext(SearchContext);

function ThemeToggle() {
  const [dark, setDark] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the theme once on mount
    setDark(attr ? attr === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("cda-theme", next ? "dark" : "light");
    } catch {
      // storage unavailable
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-panel text-muted hover:text-text"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title="Toggle theme"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = React.useState("");
  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 sm:px-5">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="SiteAId home">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">SA</span>
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-semibold">SiteAId</span>
              <span className="text-[11px] text-muted">Drawing Intelligence</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 size-4 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sites and assets"
                aria-label="Global search"
                className="h-9 w-40 rounded-lg border border-border bg-page pr-3 pl-8 text-sm outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40 sm:w-64"
              />
            </label>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
      <Toaster />
    </SearchContext.Provider>
  );
}
