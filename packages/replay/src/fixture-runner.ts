import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GeneratedFixturePlanSchema, safeWorkspacePath } from "./plan.js";

const planPath = process.argv[2];
if (planPath === undefined)
  throw new Error("Generated fixture plan path is required");
const plan = GeneratedFixturePlanSchema.parse(
  JSON.parse(readFileSync(planPath, "utf8")),
);

for (const action of plan.actions) {
  if (action.kind === "delay") {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, action.milliseconds),
    );
  } else if (action.kind === "exit") {
    process.exitCode = action.code;
    break;
  } else {
    const target = safeWorkspacePath(process.cwd(), action.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, action.content, { encoding: "utf8", flag: "w" });
  }
}
