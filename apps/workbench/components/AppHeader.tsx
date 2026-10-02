"use client";
import { Settings2, BookOpen, CircleDot } from "lucide-react";
import { Appearance } from "./Appearance";

export function AppHeader({ online, loading, home, models, guide, isHome }: {
  online: boolean; loading: boolean; isHome: boolean;
  home: () => void; models: () => void; guide: () => void;
}) {
  return <header className="app-header">
    <button className="brand" onClick={home} aria-label="PRAXIS home">
      <span className="brand-symbol"><img src="/praxis-mark.png" width="32" height="24" alt="" /></span>
      <strong>PRAXIS</strong><span className="brand-tag">Project review</span>
    </button>
    <nav aria-label="Main navigation">
      <button aria-current={isHome ? "page" : undefined} onClick={home}>Reviews</button>
      <button onClick={models}><Settings2 size={16} />Models</button>
      <button onClick={guide}><BookOpen size={16} /><span>Guide</span></button>
    </nav>
    <div className="header-utilities">
      <span className={`service-indicator ${online ? "online" : ""}`} role="status">
        <CircleDot size={12} />
        {online ? "Local service connected" : loading ? "Connecting…" : "Local service offline"}
      </span>
      <Appearance />
    </div>
  </header>;
}
