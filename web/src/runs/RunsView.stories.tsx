import type { Meta, StoryObj } from "@storybook/react";
import { RunsView } from "./RunsView";
import { withStore } from "../stories/decorators";
import { project, runs } from "../stories/fixtures";

const meta = {
  title: "Runs/RunsView",
  component: RunsView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RunsView>;
export default meta;

type Story = StoryObj<typeof meta>;

// Launcher + table together. refreshRuns() runs on mount and will fail against
// the (absent) gateway, but the seeded runs stay in the store.
export const Populated: Story = {
  decorators: [withStore({ project, runs })],
};

export const Empty: Story = {
  decorators: [withStore({ project, runs: [] })],
};
