import type { Meta, StoryObj } from "@storybook/react";
import { Footer } from "./Footer";
import { withStore } from "../stories/decorators";
import { health, healthDown } from "../stories/fixtures";

const meta = {
  title: "Shell/Footer",
  component: Footer,
} satisfies Meta<typeof Footer>;
export default meta;

type Story = StoryObj<typeof meta>;

export const GatewayOk: Story = {
  decorators: [withStore({ health })],
};

export const GatewayDown: Story = {
  decorators: [withStore({ health: healthDown })],
};
