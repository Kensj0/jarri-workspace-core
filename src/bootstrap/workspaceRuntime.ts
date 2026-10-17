import { createWorkspaceModuleRuntime } from "../core/moduleRuntime";
import { coreModule } from "../panels/corePanels";
import { demoModule } from "../panels/demoModule";
import { phoneModule } from "../modules/phone/module";

export function bootstrapWorkspaceRuntime() {
  const runtime = createWorkspaceModuleRuntime();
  runtime.registerModule(coreModule);
  runtime.registerModule(demoModule);
  runtime.registerModule(phoneModule);
  return runtime;
}

export const workspaceRuntime = bootstrapWorkspaceRuntime();

