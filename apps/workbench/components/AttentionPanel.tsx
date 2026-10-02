"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Job } from "@/lib/contracts";
import { Status } from "./ui";

type Attention = NonNullable<NonNullable<Job["assessment"]>["attention_items"]>;

export function AttentionPanel({ items, running, open }: {
  items: Attention; running: boolean; open: (area: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 3);
  return <section aria-labelledby="attention-title">
    <div className="attention-heading"><div>
      <h3 id="attention-title">What still needs attention</h3>
      <p>Next actions from the recorded evidence.</p>
    </div><span>{items.length}</span></div>
    {items.length ? <>
      <div className="attention-list">{visible.map(item => <article key={item.id} className={`attention-item ${item.priority}`}>
        <div className="attention-meta"><span>{item.area}</span><Status value={item.priority} /></div>
        <h4>{item.title}</h4><p>{item.summary}</p>
        <div className="attention-next"><strong>Next step</strong><span>{item.action}</span></div>
        <button onClick={() => open(item.area)}>
          {item.area === "models" ? "Review model access" : item.area === "findings" ? "Inspect findings" : "Open execution"}
          <ArrowRight size={14} />
        </button>
      </article>)}</div>
      {items.length > 3 && <button className="button attention-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Show fewer actions" : `Show all ${items.length} actions`}
      </button>}
    </> : <div className="attention-clear">
      <strong>{running ? "Review actions are still being collected" : "Inspect the review evidence"}</strong>
      <p>{running ? "This section updates as inspection and execution finish." : "No priority actions are listed here. Check the evidence gates and execution details before accepting the project."}</p>
    </div>}
  </section>;
}
