import {
  Component,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import type { PanelFrameControlPublisher } from "../core/frameControls";
import {
  createErrorProjection,
  createUnavailableProjection,
  type WorkspaceProjectionPublicationController,
} from "../core/projection";
import type { OpenResourceRequest, OpenResourceResult } from "../core/resources";
import type {
  PanelBodyProps,
  PanelDefinition,
  PanelInstance,
  WorkspaceModuleDefinition,
  WorkspacePreferences,
} from "../core/types";

type PanelBodyErrorBoundaryProps = {
  panelTitle: string;
  onBodyError: (error: unknown) => void;
  children: ReactNode;
};

type PanelBodyErrorBoundaryState = {
  errorMessage: string | null;
};

class PanelBodyErrorBoundary extends Component<
  PanelBodyErrorBoundaryProps,
  PanelBodyErrorBoundaryState
> {
  state: PanelBodyErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): PanelBodyErrorBoundaryState {
    return { errorMessage: safeErrorSummary(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onBodyError(error);
  }

  componentDidUpdate(previousProps: PanelBodyErrorBoundaryProps) {
    if (
      previousProps.panelTitle !== this.props.panelTitle &&
      this.state.errorMessage
    ) {
      this.setState({ errorMessage: null });
    }
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <PanelBodyFailure
          panelTitle={this.props.panelTitle}
          message={this.state.errorMessage}
        />
      );
    }

    return this.props.children;
  }
}

const PanelProjectionRenderer = memo(function PanelProjectionRenderer({
  Component,
  bodyProps,
}: {
  Component: ComponentType<PanelBodyProps>;
  bodyProps: PanelBodyProps;
}) {
  return <Component {...bodyProps} />;
});

type Props = {
  definition: PanelDefinition | null;
  panel: PanelInstance;
  preferences: WorkspacePreferences;
  modules: Array<Pick<WorkspaceModuleDefinition, "moduleId" | "title">>;
  moduleTitle?: string;
  semanticController: WorkspaceProjectionPublicationController;
  frameControlPublisher: PanelFrameControlPublisher;
  fileOperationClipboard: unknown;
  setFileOperationClipboard: (clipboard: unknown) => void;
  onPanelStateChange: (panelId: string, panelState: unknown) => void;
  onPreferencesChange: (preferences: Partial<WorkspacePreferences>) => void;
  onOpenPanel: (
    moduleId: string,
    panelType: string,
    sourcePanelId?: string,
    panelState?: unknown,
  ) => string | null;
  onOpenResource: (request: OpenResourceRequest) => OpenResourceResult;
};

export function PanelProjectionHost({
  definition,
  panel,
  preferences,
  modules,
  moduleTitle,
  semanticController,
  frameControlPublisher,
  fileOperationClipboard,
  setFileOperationClipboard,
  onPanelStateChange,
  onPreferencesChange,
  onOpenPanel,
  onOpenResource,
}: Props) {
  const failedBodyLeaseRef = useRef<
    ReturnType<WorkspaceProjectionPublicationController["publish"]> | null
  >(null);

  const semanticContext = useMemo(
    () => ({
      panel,
      moduleTitle,
      moduleId: panel.moduleId,
      panelType: panel.panelType,
      panelTitle: panel.title,
    }),
    [moduleTitle, panel],
  );

  const initialProjectionExporter = useMemo(
    () => () =>
      definition && definition.semanticStrategy.kind !== "pending"
        ? definition.semanticStrategy.buildInitial(semanticContext)
        : createUnavailableProjection(
            definition
              ? "Semantic projection is not complete for this panel."
              : "Panel definition is not registered.",
            definition
              ? "Complete this panel's semantic strategy before enabling frame Copy."
              : "Close and reopen the panel after the module is available.",
          ),
    [definition, semanticContext],
  );

  useEffect(() => {
    semanticController.setInitial(initialProjectionExporter);
  }, [initialProjectionExporter, semanticController]);

  useEffect(() => {
    return () => {
      failedBodyLeaseRef.current?.release();
      failedBodyLeaseRef.current = null;
    };
  }, [panel.id, panel.moduleId, panel.panelType]);

  const bodyProps = useMemo<PanelBodyProps>(
    () => ({
      panel,
      preferences,
      modules,
      updatePanelState: (panelState) =>
        onPanelStateChange(panel.id, panelState),
      updatePreferences: onPreferencesChange,
      fileOperationClipboard,
      setFileOperationClipboard,
      openPanel: (moduleId, panelType, panelState) =>
        onOpenPanel(moduleId, panelType, panel.id, panelState),
      openResource: (request) =>
        onOpenResource({
          ...request,
          sourcePanelId: request.sourcePanelId ?? panel.id,
        }),
      semanticPublisher: semanticController,
      frameControlPublisher,
    }),
    [
      frameControlPublisher,
      modules,
      onOpenPanel,
      onOpenResource,
      onPanelStateChange,
      onPreferencesChange,
      fileOperationClipboard,
      setFileOperationClipboard,
      panel,
      preferences,
      semanticController,
    ],
  );

  function handleBodyError(error: unknown) {
    failedBodyLeaseRef.current?.release();
    failedBodyLeaseRef.current = semanticController.publish(() =>
      createErrorProjection(safeErrorSummary(error)),
    );
  }

  return (
    <div className="panel-frame__body">
      <PanelBodyErrorBoundary
        panelTitle={panel.title}
        onBodyError={handleBodyError}
      >
        <Suspense fallback={<PanelBodyLoading />}>
          {definition?.Component ? (
            <PanelProjectionRenderer
              Component={definition.Component}
              bodyProps={bodyProps}
            />
          ) : (
            <PanelBodyFailure
              panelTitle={panel.title}
              message="Panel definition is not registered."
            />
          )}
        </Suspense>
      </PanelBodyErrorBoundary>
    </div>
  );
}

function PanelBodyLoading() {
  return (
    <div className="panel-body panel-body--loading-boundary">
      <span>Loading panel</span>
      <p>Panel frame is available while content resolves.</p>
    </div>
  );
}

function PanelBodyFailure({
  panelTitle,
  message,
}: {
  panelTitle: string;
  message: string;
}) {
  return (
    <div className="panel-body panel-body--failure-boundary" role="alert">
      <span>{panelTitle}</span>
      <strong>Panel failed</strong>
      <p>{message}</p>
    </div>
  );
}

function safeErrorSummary(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Panel body failed while rendering.";
}
