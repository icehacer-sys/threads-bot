import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("src/config.ts", root), "utf8");
const workflows = ["reply.yml","voicelearn.yml","followers.yml"];
const defaults = source.split(/\r?\n/).filter(l => !l.trimStart().startsWith("//") && /BOT_[A-Z_]+/.test(l)).map(l => l.trim());
const sections = ["# Runtime configuration", "", "Generated from tracked source. This does not read or print credentials, local .env values, or GitHub secrets. Workflow overrides take precedence over defaults. Shell assignments are listed as source expressions, not evaluated values.", "", "## Configuration declarations", "", "```ts", ...defaults, "```"];
for (const name of workflows) {
 const lines = readFileSync(new URL(".github/workflows/" + name, root), "utf8").split(/\r?\n/);
 const values = lines.filter(l => !l.trimStart().startsWith("#") && /(?:BOT_[A-Z_]+:|export BOT_|sleep \d|cron:)/.test(l) && !/secrets\.|TOKEN|KEY|PASSWORD|PAT:/.test(l)).map(l=>l.trim());
 sections.push("", "## " + name, "", "```text", ...values, "```");
}
const result = sections.join("\n") + "\n";
if (process.argv.includes("--write")) { mkdirSync(new URL("docs/", root), {recursive:true}); writeFileSync(new URL("docs/runtime-config.md",root),result); }
else console.log(result);
