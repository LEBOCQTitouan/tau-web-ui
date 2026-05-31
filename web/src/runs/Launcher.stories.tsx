import type { Meta, StoryObj } from "@storybook/react";
import { Launcher } from "./Launcher";
import { withStore } from "../stories/decorators";
import { project } from "../stories/fixtures";

const meta = {
  title: "Runs/Launcher",
  component: Launcher,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Launcher>;
export default meta;

type Story = StoryObj<typeof meta>;

export const WithAgents: Story = {
  decorators: [withStore({ project })],
};

export const NoProject: Story = {
  decorators: [withStore({ project: null })],
};
