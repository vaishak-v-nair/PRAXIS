import { FileSearch, ListChecks, ArrowRight } from "lucide-react";

/** A diagram of the workflow, not a preview of results or a running model. */
export function InspectionIllustration() {
  return <div className="inspection-illustration" aria-hidden="true">
    <div className="inspection-source"><FileSearch size={19} /><span>Your project</span></div>
    <div className="inspection-track"><span /><ArrowRight size={17} /><span /></div>
    <div className="inspection-guide"><img src="/praxis-mark.png" width="112" height="84" alt="" /></div>
    <div className="inspection-track"><span /><ArrowRight size={17} /><span /></div>
    <div className="inspection-result"><ListChecks size={19} /><span>Inspect the evidence</span></div>
  </div>;
}
