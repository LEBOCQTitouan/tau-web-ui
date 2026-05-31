import type { Meta, StoryObj } from "@storybook/react";
import { Navbar } from "./Navbar";
import { withStore } from "../stories/decorators";
import { project } from "../stories/fixtures";

const meta = {
  title: "Shell/Navbar",
  component: Navbar,
} satisfies Meta<typeof Navbar>;
export default meta;

type Story = StoryObj<typeof meta>;

// Connected — project path + version come from the store; title from the route.
export const RunsTitle: Story = {
  decorators: [withStore({ project })],
  parameters: { router: { initialEntries: ["/runs"] } },
};

export const DashboardTitle: Story = {
  decorators: [withStore({ project })],
  parameters: { router: { initialEntries: ["/dashboard"] } },
};

// No project loaded yet → "connecting…" + red engine dot.
export const Connecting: Story = {
  decorators: [withStore({ project: null })],
  parameters: { router: { initialEntries: ["/runs"] } },
};
