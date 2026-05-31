import type { Meta, StoryObj } from "@storybook/react";
import { TraceTimeline } from "./TraceTimeline";
import { withStore } from "../stories/decorators";
import { spans } from "../stories/fixtures";

const meta = {
  title: "Trace/TraceTimeline",
  component: TraceTimeline,
  parameters: { layout: "fullscreen" },
  decorators: [
    withStore({ selectedSpanId: "s-tool1" }),
    (Story) => (
      <div className="h-[360px] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TraceTimeline>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { spans } };
