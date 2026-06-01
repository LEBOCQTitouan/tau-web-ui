import { useState } from "react";
import { addProjectByPath, addProjectByGit } from "../api/projects";

export function AddProjectForm({ onAdded }: { onAdded: () => void }) {
  const [path, setPath] = useState("");
  const [git, setGit] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "path" | "git") {
    setError(null);
    try {
      if (kind === "path") {
        if (!path.trim()) return;
        await addProjectByPath(path.trim());
        setPath("");
      } else {
        if (!git.trim()) return;
        await addProjectByGit(git.trim());
        setGit("");
      }
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add project");
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-accent/50 p-3 text-xs">
      <div className="mb-2 font-semibold text-accent">+ Add project</div>
      <div className="mb-2 flex gap-2">
        <input
          aria-label="project path"
          placeholder="/abs/path/to/project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={() => submit("path")}
          className="rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Add path
        </button>
      </div>
      <div className="flex gap-2">
        <input
          aria-label="project git url"
          placeholder="https://github.com/org/repo.git"
          value={git}
          onChange={(e) => setGit(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={() => submit("git")}
          className="rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Clone
        </button>
      </div>
      {error && <div className="mt-2 text-st-error">{error}</div>}
    </div>
  );
}
