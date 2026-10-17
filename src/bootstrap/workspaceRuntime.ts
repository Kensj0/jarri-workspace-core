import { createWorkspaceModuleRuntime } from "../core/moduleRuntime";
import { coreModule } from "../panels/corePanels";
import { demoModule } from "../panels/demoModule";
import { terminalModule } from "../modules/terminal/module";
import { claudeHistoryModule } from "../modules/claude-history/module";

export function bootstrapWorkspaceRuntime() {
  const runtime = createWorkspaceModuleRuntime();
  runtime.registerModule(coreModule);
  runtime.registerModule(demoModule);
  runtime.registerModule(terminalModule);
  runtime.registerModule(claudeHistoryModule);
  return runtime;
}

export const workspaceRuntime = bootstrapWorkspaceRuntime();

