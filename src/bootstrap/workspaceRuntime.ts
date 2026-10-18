import { createWorkspaceModuleRuntime } from "../core/moduleRuntime";
import { coreModule } from "../panels/corePanels";
import { demoModule } from "../panels/demoModule";
import { createModuleStoreModule } from "../modules/module-store/module";
import { appViewModule } from "../modules/app-view/module";
import { browserModule } from "../modules/browser/module";

export function bootstrapWorkspaceRuntime() {
  const runtime = createWorkspaceModuleRuntime();
  runtime.registerModule(coreModule);
  runtime.registerModule(demoModule);
  runtime.registerModule(createModuleStoreModule(() => runtime.getModuleRecords()));
  runtime.registerModule(appViewModule);
  runtime.registerModule(browserModule);
  return runtime;
}

export const workspaceRuntime = bootstrapWorkspaceRuntime();

