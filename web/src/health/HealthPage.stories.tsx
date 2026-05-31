import type { Meta, StoryObj } from "@storybook/react";
import { HealthPage } from "./HealthPage";

const meta = {
  title: "Pages/HealthPage",
  component: HealthPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HealthPage>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
