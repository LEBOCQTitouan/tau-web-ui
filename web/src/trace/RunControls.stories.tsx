import type { Meta, StoryObj } from "@storybook/react";
import { RunControls } from "./RunControls";
import { withStore } from "../stories/decorators";
import { trace, runs } from "../stories/fixtures";

const meta = {
  title: "Trace/RunControls",
  component: RunControls,
  parameters: { layout: "padded" },
} satisfies Meta<typeof RunControls>;
export default meta;

type Story = StoryObj<typeof meta>;

// Running → shows the Cancel button.
export const Running: Story = {
  decorators: [withStore({ currentTrace: trace })],
};

// Completed run → no Cancel button.
export const Completed: Story = {
  decorators: [withStore({ currentTrace: { run: runs[0], spans: [] } })],
};
