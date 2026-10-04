"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const key = "praxis-appearance";

export function Appearance() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const sync = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(key, next); } catch { /* Appearance works when browser storage is unavailable. */ }
  }
  return <button className="icon appearance-toggle" onClick={toggle}
    aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}
    title={`Use ${theme === "light" ? "dark" : "light"} theme`}>
    {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
  </button>;
}
