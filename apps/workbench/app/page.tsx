"use client";
import { useState } from "react";
import { RefreshCw, X, ArrowLeft } from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import { Intake } from "@/components/Intake";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { ProviderModal } from "@/components/ProviderModal";
import { ActionModal } from "@/components/ActionModal";
import { Notice, Empty } from "@/components/ui";
import { AppHeader } from "@/components/AppHeader";
import { ReviewHistory } from "@/components/ReviewHistory";
import { ProjectHome } from "@/components/ProjectHome";
import { ProjectGuide } from "@/components/ProjectGuide";
import { ProjectCommandBar } from "@/components/ProjectCommandBar";

export default function Home() {
  const workspace = useWorkspace();
  const [dialog, setDialog] = useState<"models" | "guide" | "verify" | "apply" | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const newReview = () => { setProjectQuery(""); workspace.open(null, false, true); };
  const openProject = (id: string) => { setProjectQuery(""); workspace.open(id); };
  const jobAction = (name: string, body: unknown) => workspace.mutate(`/jobs/${encodeURIComponent(workspace.job!.id)}/${name}`, body);
  const selectedProvider = workspace.health?.settings?.provider || "";
  const connectedModel = selectedProvider && workspace.health?.settings?.model ? {
    provider: selectedProvider,
    model: workspace.health.settings.model,
    configured: !!workspace.health.providers?.find(item => item.name === selectedProvider)?.configured,
  } : undefined;
  return <div className="lab workspace-shell">
    <a href="#main" className="skip-link">Skip to workspace</a>
    <AppHeader online={workspace.online} loading={workspace.loading} isHome={!workspace.id}
      creating={workspace.creating} newReview={newReview}
      home={() => workspace.open(null)} models={() => setDialog("models")} guide={() => setDialog("guide")} />
    <main id="main" className="main-container">
      {!workspace.id && !workspace.creating && <div className="workspace-command-row"><ProjectCommandBar items={workspace.projectPage?.items || []} query={projectQuery} setQuery={setProjectQuery} openProject={openProject} newReview={newReview} /></div>}
      {!workspace.online && !workspace.loading && <Notice error><strong>Start your local service to continue.</strong><p>Restart the terminal session that launched Project Review, then retry this connection. Your saved results remain in the local data folder.</p><button className="button" onClick={() => void workspace.refresh()}><RefreshCw size={14} />Retry connection</button></Notice>}
      {workspace.error && <div className="error-row"><Notice error>{workspace.error}</Notice><button className="icon" aria-label="Dismiss error" onClick={() => workspace.setError("")}><X size={16} /></button></div>}
      {workspace.loadingJob ? <section className="loading-surface" aria-busy="true"><div className="skeleton" /><div className="skeleton short" /><p>Loading review…</p></section> : workspace.job ? <ReviewWorkspace key={workspace.job.id} job={workspace.job} view={workspace.view} setView={workspace.navigate} connectedModel={connectedModel} openModels={() => setDialog("models")} busy={workspace.busy} streaming={workspace.streaming} back={() => workspace.open(null)} action={(name, body) => jobAction(name, body).catch(() => undefined)} verify={() => setDialog("verify")} apply={() => setDialog("apply")} /> : workspace.id ? <Empty title="Review could not be loaded"><p>Check the local connection or return to your projects.</p><button className="button" onClick={() => workspace.open(null)}>Projects</button></Empty> : workspace.creating || (!workspace.loading && !workspace.jobs.length && !workspace.projectPage?.items.length) ? <div className="create-review">
        {!!workspace.jobs.length && <button className="back-link" onClick={() => workspace.open(null)}><ArrowLeft size={15} />Projects</button>}
        <h1 className="creation-heading">New review</h1>
        <Intake disabled={workspace.busy || !workspace.online} health={workspace.health}
          models={() => setDialog("models")} start={body => workspace.mutate("/scans", body)} />
      </div> : <>
        <ProjectHome items={workspace.projectPage?.items || []} total={workspace.projectPage?.total || 0} search={projectQuery}
          nextOffset={workspace.projectPage?.next_offset ?? null} loading={workspace.loading}
          error={workspace.projectError} loadingMore={workspace.loadingMoreProjects}
          loadMore={() => void workspace.loadMoreProjects()} open={openProject} newReview={newReview} />
        {!!workspace.jobs.length && <details className="review-history-disclosure"><summary>Review history <span>{workspace.jobs.length}</span></summary>
          <ReviewHistory jobs={workspace.jobs} loading={workspace.loading} open={id => workspace.open(id)} />
        </details>}
      </>}
    </main>
    {dialog === "models" && <ProviderModal health={workspace.health} close={() => setDialog(null)} saved={value => { workspace.setHealth(value); void workspace.refresh(); }} />}
    {(dialog === "verify" || dialog === "apply") && workspace.job && <ActionModal kind={dialog} job={workspace.job} docker={workspace.health?.docker} close={() => setDialog(null)} submit={body => jobAction(dialog, body)} />}
    {dialog === "guide" && <ProjectGuide close={() => setDialog(null)} />}
  </div>;
}
