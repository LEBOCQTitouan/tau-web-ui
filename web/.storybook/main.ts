import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-themes"],
  framework: { name: "@storybook/react-vite", options: {} },
  // Reuse the app's vite.config.ts (Tailwind via PostCSS works out of the box).
  core: { disableTelemetry: true },
};

export default config;
