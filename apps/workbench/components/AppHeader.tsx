"use client";
import { Settings2, BookOpen, CircleDot, Plus, PanelsTopLeft } from "lucide-react";
import { Appearance } from "./Appearance";

export function AppHeader({ online, loading, home, models, guide, isHome, creating, newReview }: {
  online: boolean; loading: boolean; isHome: boolean;
  home: () => void; models: () => void; guide: () => void;
  creating: boolean; newReview: () => void;
}) {
  return <header className="app-header">
    <button className="brand" onClick={home} aria-label="PRAXIS home">
      <span className="brand-symbol"><img src="/praxis-mark.png" width="32" height="24" alt="" /></span>
      <strong>PRAXIS</strong>
    </button>
    <button className="button primary new-review" onClick={newReview} aria-current={creating ? "page" : undefined}><Plus size={16} />New review</button>
    <nav aria-label="Main navigation">
      <button aria-current={isHome && !creating ? "page" : undefined} onClick={home}><PanelsTopLeft size={16} />Projects</button>
    </nav>
    <nav className="sidebar-settings" aria-label="Workspace settings">
      <button onClick={models}><Settings2 size={16} />Models</button>
      <button onClick={guide}><BookOpen size={16} /><span>Help</span></button>
    </nav>
    <div className="header-utilities">
      <span className={`service-indicator ${online ? "online" : ""}`} role="status">
        <CircleDot size={12} />
        {online ? "Connected locally" : loading ? "Connecting…" : "Service offline"}
      </span>
      <div className="sidebar-appearance"><span>Appearance</span><Appearance /></div>
    </div>
  </header>;
}
