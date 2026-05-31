import type { Decorator } from "@storybook/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useStore } from "../store/store";

type StoreState = ReturnType<typeof useStore.getState>;
type StoreData = Pick<
  StoreState,
  "health" | "project" | "runs" | "currentTrace" | "assistantText" | "selectedSpanId"
>;

// A clean data baseline applied before every story so seeded state from one
// story never bleeds into the next. Action methods on the store are untouched.
const CLEAN: StoreData = {
  health: null,
  project: null,
  runs: [],
  currentTrace: null,
  assistantText: "",
  selectedSpanId: null,
};

/**
 * Seed the zustand singleton before a story renders. Store-coupled components
 * (Footer, Navbar, RunControls, trace views…) read live state, so this is what
 * lets them render in isolation without a running gateway.
 */
export function withStore(state: Partial<StoreData> = {}): Decorator {
  return (Story) => {
    useStore.setState({ ...CLEAN, ...state }, false);
    return <Story />;
  };
}

/**
 * Render a story at a specific route. Useful for components that branch on the
 * URL (e.g. Navbar's title) or read route params (TracePage). The global
 * preview decorator already provides a default MemoryRouter at "/runs"; use
 * this when a story needs a different path or nested <Outlet> routing.
 */
export function withRoute(path: string, routePattern = "*"): Decorator {
  return (Story) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={<Story />} />
      </Routes>
    </MemoryRouter>
  );
}
