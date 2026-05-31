import type { Meta, StoryObj } from "@storybook/react";
import { RunsPage } from "./RunsPage";
import { withStore } from "../stories/decorators";
import { project, runs } from "../stories/fixtures";

const meta = {
  title: "Pages/RunsPage",
  component: RunsPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RunsPage>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withStore({ project, runs })],
};
