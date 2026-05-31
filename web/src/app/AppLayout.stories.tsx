import type { Meta, StoryObj } from "@storybook/react";
import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { RunsView } from "../runs/RunsView";
import { withStore } from "../stories/decorators";
import { project, health, runs } from "../stories/fixtures";

const meta = {
  title: "Shell/AppLayout",
  component: AppLayout,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppLayout>;
export default meta;

type Story = StoryObj<typeof meta>;

// Full app frame: Sidebar + Navbar + Footer around a routed <Outlet>.
// <Routes> nests inside the global preview router (initial path "/runs").
export const Default: Story = {
  decorators: [withStore({ project, health, runs })],
  parameters: { router: { initialEntries: ["/runs"] } },
  render: () => (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/runs" element={<RunsView />} />
      </Route>
    </Routes>
  ),
};
