import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Tabs } from "./Tabs";

// Tabs is controlled; a tiny stateful wrapper makes the toggle interactive.
function TabsDemo() {
  const [value, setValue] = useState("graph");
  return (
    <Tabs
      tabs={[
        { id: "graph", label: "Graph" },
        { id: "timeline", label: "Timeline" },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

const meta = {
  title: "Primitives/Tabs",
  component: Tabs,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Tabs<string>>;
export default meta;

export const Default: StoryObj = {
  render: () => <TabsDemo />,
};
