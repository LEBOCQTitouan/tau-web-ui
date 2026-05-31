import { useEffect } from "react";
import { useStore } from "../store/store";

export function ProjectBar() {
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  useEffect(() => {
    loadProject().catch(() => {});
  }, [loadProject]);

  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2">
      <strong className="text-sm">tau-web-ui</strong>
      <span className="font-mono text-xs text-muted">{project?.project_path ?? "connecting…"}</span>
      <span className="ml-auto text-xs text-muted">tau {project?.tau_version ?? "—"}</span>
      <span
        title={project ? "engine reachable" : "no engine"}
        className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
      />
    </header>
  );
}
