import { useState } from "react";
import { SkillsIndex } from "./SkillsIndex";
import { ToolsTab } from "./ToolsTab";

export function ToolsPage() {
  const [tab, setTab] = useState<"skills" | "tools">("skills");
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
    }`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <button className={chip(tab === "skills")} onClick={() => setTab("skills")}>
            Skills
          </button>
          <button className={chip(tab === "tools")} onClick={() => setTab("tools")}>
            Tools
          </button>
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md px-3 py-1 text-xs font-semibold text-muted opacity-50"
          >
            Plugins{" "}
            <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
              soon
            </span>
          </span>
        </div>
      </div>
      {tab === "skills" ? <SkillsIndex /> : <ToolsTab />}
    </div>
  );
}
