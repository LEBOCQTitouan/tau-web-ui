import type { Meta, StoryObj } from "@storybook/react";
import { StatusBadge, SubstrateModeBadge } from "./badges";

const meta = {
  title: "Primitives/Badges",
  component: StatusBadge,
  parameters: { layout: "padded" },
  argTypes: {
    status: {
      control: "select",
      options: ["running", "completed", "failed", "cancelled"],
    },
  },
} satisfies Meta<typeof StatusBadge>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Status: Story = { args: { status: "running" } };

export const AllStatuses: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="running" />
      <StatusBadge status="completed" />
      <StatusBadge status="failed" />
      <StatusBadge status="cancelled" />
    </div>
  ),
};

export const SubstrateMode: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <SubstrateModeBadge substrate="host" mode="dev" />
      <SubstrateModeBadge substrate="wasm" mode="prod" />
      <SubstrateModeBadge substrate="c-abi" mode="dev" />
      <SubstrateModeBadge substrate="mcu" mode="prod" />
    </div>
  ),
};
