import { createWorkspaceModuleRuntime } from "../core/moduleRuntime";
import { coreModule } from "../panels/corePanels";
import { demoModule } from "../panels/demoModule";
import { kennystunerModule } from "../panels/kennystunerModule";
import { terminalModule } from "../modules/terminal/module";
import { phoneModule } from "../modules/phone/module";
import { aiUsageModule } from "../modules/ai-usage/module";
import { chronogitModule } from "../modules/chronogit/module";

export function bootstrapWorkspaceRuntime() {
  const runtime = createWorkspaceModuleRuntime();
  runtime.registerModule(coreModule);
  runtime.registerModule(demoModule);
  runtime.registerModule(kennystunerModule);
  runtime.registerModule(terminalModule);
  runtime.registerModule(phoneModule);
  runtime.registerModule(aiUsageModule);
  runtime.registerModule(chronogitModule);
  return runtime;
}

export const workspaceRuntime = bootstrapWorkspaceRuntime();

