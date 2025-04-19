import { number, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { playAudit } from 'playwright-lighthouse';
import fs from 'fs/promises';
import path from 'path';
import type { ToolFactory } from './tool';
import type { Page as CorePage } from "playwright-core";
// 1 schema ------------------------------------------------------------------
const lighthouseAuditSchema = z.object({
  categories: z
    .array(z.enum(['performance','accessibility','seo','best-practices','pwa']))
    .default(['accessibility']),
  formFactor: z.enum(['desktop','mobile']).default('desktop'),
  output: z.enum(['html','json']).default('html'),
  thresholds: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      "Key‑value map of category → minimum score (0‑100). Build fails if any category falls below its threshold."
    ),
});

const lighthouseAudit: ToolFactory = captureSnapshot => ({
  capability: 'core',
  schema: {
    name: 'lighthouse_audit',
    description: 'Run Google Lighthouse against the current page or a supplied URL',
    inputSchema: zodToJsonSchema(lighthouseAuditSchema)
  },

  // 2 handler ---------------------------------------------------------------
  handle: async (context, params) => {
    const opts = lighthouseAuditSchema.parse(params);
    const tab = await context.ensureTab();
    const page = tab.page as CorePage;           // audit current page

    // ---------------------------------------------------------------------
    // Derive the remote‑debugging port from the existing Playwright browser
    // ---------------------------------------------------------------------
    let port: string | undefined = context.options.launchOptions?.args?.find(arg => arg.startsWith('--remote-debugging-port='))?.split('=')[1];
    
    if (!port) {
      throw new Error(
        "The Playwright browser was not launched with --remote-debugging-port=<n>. " +
          "Restart the MCP server with that flag so Lighthouse can attach."
      );
    }

    

    // ---------------------------------------------------------------------
    // Run Lighthouse audit via playwright-lighthouse
    // ---------------------------------------------------------------------
    const reportDir = path.join(process.cwd(), "lighthouse-reports");
    await fs.mkdir(reportDir, { recursive: true });

    const reportFileBase = `lighthouse-${Date.now()}`;
    const formats = {
      html: opts.output === "html",
      json: opts.output === "json",
    };

    const result = await playAudit({
      page,
      port: parseInt(port, 10),
      thresholds: opts.thresholds,
      opts: {logLevel: 'error'},
      reports: {
        formats,
        name: reportFileBase,
        directory: reportDir,
      },
    });

    console.log("Lighthouse audit result:", result.lhr);

    const generatedFiles: Array<{ path: string; mediaType: string }> = [];
    if (formats.html) {
      generatedFiles.push({
        path: path.join(reportDir, `${reportFileBase}.html`),
        mediaType: "text/html",
      });
    }
    if (formats.json) {
      generatedFiles.push({
        path: path.join(reportDir, `${reportFileBase}.json`),
        mediaType: "application/json",
      });
    }

    // ---------------------------------------------------------------------
    // Return MCP response
    // ---------------------------------------------------------------------
    return {
      code: [
        "// Lighthouse audit via playwright-lighthouse",
        `await playAudit({ page, port: ${port}, /* ... */ });`,
      ],
      files: generatedFiles,
      captureSnapshot,
      waitForNetwork: false,
      data: {
        scores: Object.fromEntries(
          Object.entries(result.lhr.categories).map(([k, v]) => [k, v.score])
        ),
      },
    };
  }
});


export default (captureSnapshot: boolean) => [lighthouseAudit(captureSnapshot)];
