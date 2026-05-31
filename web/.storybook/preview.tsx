import type { Preview } from "@storybook/react";
import { withThemeByClassName } from "@storybook/addon-themes";
import { MemoryRouter } from "react-router-dom";

// App styles + xyflow styles, then the Storybook-only dark vars.
import "../src/index.css";
import "@xyflow/react/dist/style.css";
import "./storybook-theme.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      storySort: { order: ["Shell", "Runs", "Trace", "Pages", "Primitives"] },
    },
  },
  decorators: [
    // Toolbar light/dark toggle — flips the `dark` class on <html> (Tailwind darkMode: "class").
    withThemeByClassName({
      themes: { light: "", dark: "dark" },
      defaultTheme: "light",
    }),
    // Single app-wide router so react-router hooks (NavLink / useLocation /
    // useNavigate / useParams) work everywhere. The initial path is per-story:
    // set `parameters.router.initialEntries` to control it. Stories that need
    // route params render their own <Routes> INSIDE this router (never another
    // <Router> — react-router forbids nesting them).
    (Story, ctx) => {
      const initialEntries = ctx.parameters.router?.initialEntries ?? ["/runs"];
      return (
        <MemoryRouter initialEntries={initialEntries}>
          <div className="min-h-[140px] bg-bg p-4 text-fg">
            <Story />
          </div>
        </MemoryRouter>
      );
    },
  ],
};

export default preview;
