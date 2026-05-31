import type { Meta, StoryObj } from "@storybook/react";
import { TraceGraph } from "./TraceGraph";
import { withStore } from "../stories/decorators";
import { spans } from "../stories/fixtures";

const meta = {
  title: "Trace/TraceGraph",
  component: TraceGraph,
  parameters: { layout: "fullscreen" },
  // Needs a sized parent (ReactFlow fills its container) + the store for selection.
  decorators: [
    withStore({ selectedSpanId: "s-tool1" }),
    (Story) => (
      <div className="h-[480px] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TraceGraph>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { spans } };
