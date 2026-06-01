import { useState } from "react";
import type { ProjectMeta } from "../types/ProjectMeta";
import { saveWorkspaceAs } from "../api/projects";

export function SaveAsProjectForm({ onSaved }: { onSaved: (m: ProjectMeta) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) return;
    try {
      onSaved(await saveWorkspaceAs(name.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  return (
    <div className="mt-2 text-xs">
      <div className="flex gap-2">
        <input
          aria-label="project name"
          placeholder="project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={submit}
          className="whitespace-nowrap rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Save as project
        </button>
      </div>
      {error && <div className="mt-1 text-st-error">{error}</div>}
    </div>
  );
}
