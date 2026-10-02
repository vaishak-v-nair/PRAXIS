import { ArrowUpRight, CircleDot, Plus } from "lucide-react";
export function StatusBar({ online, newReview, guide }: { online: boolean; newReview: () => void; guide: () => void }) {
  return <footer className="app-footer"><span className="footer-brand">PRAXIS <span className="footer-divider">/</span> Final engineering check</span><span className="footer-state" data-state={online ? "online" : "offline"}><CircleDot size={12} />{online ? "Local workspace" : "Service offline"}</span><div><button className="footer-guide" onClick={guide}>How it works<ArrowUpRight size={13} /></button><button className="button primary" onClick={newReview}><Plus size={15} />New review</button></div></footer>;
}
