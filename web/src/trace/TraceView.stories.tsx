import type { Meta, StoryObj } from "@storybook/react";
import { TraceView } from "./TraceView";
import { withStore } from "../stories/decorators";
import { trace } from "../stories/fixtures";

const meta = {
  title: "Trace/TraceView",
  component: TraceView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TraceView>;
export default meta;

type Story = StoryObj<typeof meta>;

// Full trace surface: tabs + graph/timeline + inspector + assistant stream.
export const WithTrace: Story = {
  decorators: [withStore({ currentTrace: trace, selectedSpanId: "s-tool1" })],
};

export const NoTrace: Story = {
  decorators: [withStore({ currentTrace: null })],
};
