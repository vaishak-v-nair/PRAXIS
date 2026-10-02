"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, AlertCircle, Terminal, Check, Minus, TriangleAlert, BrainCircuit } from "lucide-react";
import { statusMeta } from "@/lib/status.mjs";

export function Status({ value }: { value: string }) {
  const meta = statusMeta(value);
  const Icon = meta.icon === "model" ? BrainCircuit : meta.icon === "check" ? Check : meta.icon === "error" ? AlertCircle : meta.icon === "warning" ? TriangleAlert : Minus;
  return <span className={`status ${meta.tone}`}><Icon size={12} /><span>{meta.label}</span></span>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? "notice-error" : ""}`} role={error ? "alert" : "status"}><AlertCircle size={17} /><div>{children}</div></div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><Terminal size={26} /><h3>{title}</h3><div>{children}</div></div>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const close = useRef<HTMLButtonElement>(null); const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal(); close.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", trap);
    return () => { dialog.removeEventListener("keydown", trap); if (dialog.open) dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={id}>{title}</h2><button ref={close} className="icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>
    <div className="modal-content">{children}</div>
  </dialog>;
}
