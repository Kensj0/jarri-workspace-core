import { createWorkspaceModuleRuntime } from "../core/moduleRuntime";
import { coreModule } from "../panels/corePanels";
import { demoModule } from "../panels/demoModule";
import { kennystunerModule } from "../panels/kennystunerModule";

export function bootstrapWorkspaceRuntime() {
  const runtime = createWorkspaceModuleRuntime();
  runtime.registerModule(coreModule);
  runtime.registerModule(demoModule);
  runtime.registerModule(kennystunerModule);
  return runtime;
}

export const workspaceRuntime = bootstrapWorkspaceRuntime();

