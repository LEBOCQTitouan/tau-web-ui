import type { Meta, StoryObj } from "@storybook/react";
import { AssistantStream } from "./AssistantStream";
import { withStore } from "../stories/decorators";
import { assistantText } from "../stories/fixtures";

const meta = {
  title: "Trace/AssistantStream",
  component: AssistantStream,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AssistantStream>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
  decorators: [withStore({ assistantText })],
};

export const Empty: Story = {
  decorators: [withStore({ assistantText: "" })],
};
