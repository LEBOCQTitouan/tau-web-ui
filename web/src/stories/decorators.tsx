import type { Decorator } from "@storybook/react";
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

// To render a story at a specific route, set `parameters.router.initialEntries`
// (the global preview decorator owns the single MemoryRouter). For route params
// or <Outlet> nesting, give the story a `render` that returns <Routes> — those
// nest fine inside the global router; a second <Router> does not.
