import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { RunsTable } from "./RunsTable";
import { runs } from "../stories/fixtures";

const meta = {
  title: "Runs/RunsTable",
  component: RunsTable,
  parameters: { layout: "padded" },
  args: { onOpen: fn() },
} satisfies Meta<typeof RunsTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = { args: { runs } };

export const Empty: Story = { args: { runs: [] } };
