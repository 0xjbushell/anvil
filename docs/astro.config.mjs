import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://0xjbushell.github.io",
  base: "/anvil",
  integrations: [
    starlight({
      title: "Anvil",
      description: "Public documentation for Anvil's agent-ready project scaffolding.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/0xjbushell/anvil" }],
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Getting Started", slug: "getting-started" },
            { label: "Installation", slug: "installation" },
            { label: "Existing Projects", slug: "existing-projects" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Reference", slug: "cli-reference" },
            { label: "How Anvil Works", slug: "how-anvil-works" },
            { label: "Using with Coding Agents", slug: "using-with-coding-agents" },
            { label: "Troubleshooting", slug: "troubleshooting" },
          ],
        },
        {
          label: "Languages",
          items: [
            { label: "TypeScript/JavaScript", slug: "languages/typescript" },
            { label: "Go", slug: "languages/golang" },
            { label: "Python", slug: "languages/python" },
          ],
        },
        {
          label: "Examples",
          items: [
            { label: "Greenfield TypeScript", slug: "examples/greenfield-typescript" },
            { label: "Greenfield Go", slug: "examples/greenfield-golang" },
            { label: "Greenfield Python", slug: "examples/greenfield-python" },
            { label: "Existing Project", slug: "examples/existing-project" },
          ],
        },
      ],
    }),
  ],
});
