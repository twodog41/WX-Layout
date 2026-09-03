import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

export default defineConfig({
  plugins: [
    vinext(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: {
        main: "vinext/server/app-router-entry",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: hostingConfig.d1 ? [{
          binding: hostingConfig.d1,
          database_name: "wx-layout-stars",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID
        }] : []
      }
    })
  ]
});
