/// <reference types="vite/client" />
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, beforeAll } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { composeStories, setProjectAnnotations } from "@storybook/react";
import * as previewAnnotations from "../../.storybook/preview";

// jsdom lacks APIs that @xyflow/react (TraceGraph) touches on mount.
beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver;
});

// Apply the global preview decorators (the single MemoryRouter, theme, layout)
// so composed stories render exactly like they do in Storybook.
setProjectAnnotations(previewAnnotations);

afterEach(() => cleanup());

// Render every story to prove decorators + render functions compose without
// throwing — this is what catches regressions like nested <Router> errors.
const storyModules = import.meta.glob("../**/*.stories.tsx", { eager: true });

for (const [path, mod] of Object.entries(storyModules)) {
  const composed = composeStories(mod as Parameters<typeof composeStories>[0]);
  describe(path.replace("../", "src/"), () => {
    for (const [name, Story] of Object.entries(composed)) {
      const StoryComponent = Story as ComponentType;
      it(`${name} renders`, () => {
        expect(() => render(<StoryComponent />)).not.toThrow();
      });
    }
  });
}
