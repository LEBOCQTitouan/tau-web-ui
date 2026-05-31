import type { Meta, StoryObj } from "@storybook/react";
import { SpanInspector } from "./SpanInspector";
import { spans } from "../stories/fixtures";

const meta = {
  title: "Trace/SpanInspector",
  component: SpanInspector,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SpanInspector>;
export default meta;

type Story = StoryObj<typeof meta>;

// A tool_call span with args + result + usage.
export const ToolCall: Story = {
  args: { span: spans.find((s) => s.id === "s-tool1") ?? null },
};

// A span that errored.
export const Errored: Story = {
  args: { span: spans.find((s) => s.id === "s-tool3") ?? null },
};

export const NothingSelected: Story = {
  args: { span: null },
};
