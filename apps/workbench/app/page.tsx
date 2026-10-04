"use client";
import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import { Intake } from "@/components/Intake";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { ProviderModal } from "@/components/ProviderModal";
import { ActionModal } from "@/components/ActionModal";
import { Notice, Empty } from "@/components/ui";
import { AppHeader } from "@/components/AppHeader";
import { ReviewHistory } from "@/components/ReviewHistory";
import { ProjectGuide } from "@/components/ProjectGuide";
import { StatusBar } from "@/components/StatusBar";
import { InspectionIllustration } from "@/components/InspectionIllustration";

export default function Home() {
  const workspace = useWorkspace();
  const [dialog, setDialog] = useState<"models" | "guide" | "verify" | "apply" | null>(null);
  const jobAction = (name: string, body: unknown) => workspace.mutate(`/jobs/${encodeURIComponent(workspace.job!.id)}/${name}`, body);
  const selectedProvider = workspace.health?.settings?.provider || "";
  const connectedModel = selectedProvider && workspace.health?.settings?.model ? {
    provider: selectedProvider,
    model: workspace.health.settings.model,
    configured: !!workspace.health.providers?.find(item => item.name === selectedProvider)?.configured,
  } : undefined;
  return <div className="lab">
    <a href="#main" className="skip-link">Skip to workspace</a>
    <AppHeader online={workspace.online} loading={workspace.loading} isHome={!workspace.id}
      home={() => workspace.open(null)} models={() => setDialog("models")} guide={() => setDialog("guide")} />
    <main id="main" className="main-container">
      {!workspace.online && !workspace.loading && <Notice error><strong>Start your local service to continue.</strong><p>Restart the terminal session that launched Project Review, then retry this connection. Your saved results remain in the local data folder.</p><button className="button" onClick={() => void workspace.refresh()}><RefreshCw size={14} />Retry connection</button></Notice>}
      {workspace.error && <div className="error-row"><Notice error>{workspace.error}</Notice><button className="icon" aria-label="Dismiss error" onClick={() => workspace.setError("")}><X size={16} /></button></div>}
      {workspace.loadingJob ? <section className="loading-surface" aria-busy="true"><div className="skeleton" /><div className="skeleton short" /><p>Loading review…</p></section> : workspace.job ? <ReviewWorkspace key={workspace.job.id} job={workspace.job} connectedModel={connectedModel} openModels={() => setDialog("models")} busy={workspace.busy} streaming={workspace.streaming} back={() => workspace.open(null)} action={(name, body) => jobAction(name, body).catch(() => undefined)} verify={() => setDialog("verify")} apply={() => setDialog("apply")} /> : workspace.id ? <Empty title="Review could not be loaded"><p>Check the local connection or return to your reviews.</p><button className="button" onClick={() => workspace.open(null)}>All reviews</button></Empty> : <>
        <div className="home-heading"><div><div className="section-label"><span className="accent-dot" />Your local inspection workspace</div>
          <h1>Before you ship,<br /><span>see what holds up.</span></h1>
          <p>Bring the project you built with AI. Find what works, what could fail, and what to fix next—with evidence you can inspect.</p>
        </div><InspectionIllustration /></div>
        <Intake disabled={workspace.busy || !workspace.online} health={workspace.health}
          models={() => setDialog("models")} start={body => workspace.mutate("/scans", body)} />
        <ReviewHistory jobs={workspace.jobs} loading={workspace.loading} open={id => workspace.open(id)} />
      </>}
    </main>
    <StatusBar online={workspace.online} newReview={() => workspace.open(null)} guide={() => setDialog("guide")} />
    {dialog === "models" && <ProviderModal health={workspace.health} close={() => setDialog(null)} saved={value => { workspace.setHealth(value); void workspace.refresh(); }} />}
    {(dialog === "verify" || dialog === "apply") && workspace.job && <ActionModal kind={dialog} job={workspace.job} docker={workspace.health?.docker} close={() => setDialog(null)} submit={body => jobAction(dialog, body)} />}
    {dialog === "guide" && <ProjectGuide close={() => setDialog(null)} />}
  </div>;
}
