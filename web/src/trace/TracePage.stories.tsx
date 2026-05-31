import type { Meta, StoryObj } from "@storybook/react";
import { Routes, Route } from "react-router-dom";
import { TracePage } from "./TracePage";
import { withStore } from "../stories/decorators";
import { trace } from "../stories/fixtures";

const meta = {
  title: "Pages/TracePage",
  component: TracePage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TracePage>;
export default meta;

type Story = StoryObj<typeof meta>;

// openTrace() fires on mount and fails against the absent gateway, but the
// seeded trace stays in the store so the view renders. <Routes> nests inside
// the global preview router; initialEntries puts :id = run-002 in the URL.
export const Default: Story = {
  decorators: [withStore({ currentTrace: trace, selectedSpanId: "s-tool1" })],
  parameters: { router: { initialEntries: ["/runs/run-002"] } },
  render: () => (
    <Routes>
      <Route path="/runs/:id" element={<TracePage />} />
    </Routes>
  ),
};
