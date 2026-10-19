# Jarri Workspace Core

Reusable cognitive workspace substrate for Jarri-style panel, module, observatory, and operator-console systems.

> **Current development line:** Workspace Core 0.3.0 release candidate
> The final 0.3.0 release is pending clean-machine installation and integration verification.

## What Workspace Core Is

Jarri Workspace Core is a reusable desktop workspace framework for building
persistent, spatial, panel-based applications.

It provides the generic workspace machinery shared by systems such as Jarri
Workspace Lab and future Jarri-style observatories, while deliberately keeping
domain-specific integrations outside Core.

Core owns the reusable workspace substrate:

- workspace tabs and logical canvases
- panel instance behavior and geometry
- deterministic layout persistence
- module and panel registration
- resource opening and presentation
- workspace camera and spatial navigation
- appearance and theme infrastructure
- generic workspace controls
- filesystem and generic media surfaces
- projection and semantic panel contracts

Domain applications remain responsible for their own runtime truth, services,
business logic, and specialized panels.

## Architecture

Workspace Core follows a simple ownership model:

    Domain services
          ↓
    Domain modules
          ↓
    Workspace Core
          ↓
    Projection / presentation

Workspace Core does not become the source of domain truth merely because it
displays that truth.

Important architectural principles include:

- deterministic behavior first
- logical geometry is authoritative; visual scale is presentation
- persisted state must remain repairable
- runtime truth is not persisted as workspace truth
- modules register capabilities instead of modifying the shell
- panels own their body content; Workspace owns generic frame behavior
- resource identity is distinct from presentation memory
- advisory, truth, preflight, and temporal semantics remain explicit
- generic infrastructure belongs in Core; domain-specific behavior does not

The engineering doctrine is:

    Investigate → Implement → Verify → Challenge → Document

Detailed contracts live under `docs/contracts/`.

## Workspace System

The current Core provides:

- multi-tab workspaces
- persistent tab state
- expandable logical workspace canvases
- independent tab-local camera state
- pan and zoom navigation
- configurable canvas bounds
- movable and resizable panels
- panel minimization and restoration
- deterministic focus ordering
- persistent panel geometry
- presentation-memory-aware panel creation
- preferred initial geometry for content-aware resources
- panel setup/template import and export
- missing-panel repair behavior
- logical whole-workspace screenshot capture

Native window resizing is kept separate from logical camera position so viewport
changes do not corrupt the user's location in workspace space.

## Module And Panel System

Modules register panels through the Workspace runtime rather than hard-wiring
them into the shell.

Core currently owns these generic panel surfaces:

- **Settings**
- **Themes / Colours**
- **Colour Picker**
- **File Browser**
- **Text Viewer**
- **Image Viewer**
- **Missing Panel** recovery surface

The repository also contains a demonstration module used to exercise semantic
panel behavior such as truth, advisory, and temporal/replay projections. Those
demo panels are examples, not Core domain facilities.

## File Browser And Resources

Workspace Core contains a native Tauri-backed filesystem surface.

The File Browser currently supports:

- directory browsing
- tree and content views
- directory navigation
- browser-root management
- recursive bounded search
- search cancellation
- hidden-file handling
- sorting
- folder-first presentation
- copy and cut operations
- rename
- delete
- new-folder creation
- semantic file classification
- resource-aware opening

Search is rooted in the directory the user is actually browsing rather than an
unrelated historical root.

Filesystem discovery and resource presentation are deliberately separate.
Finding a file does not imply that Core has a suitable viewer for it.

## Text Resources

Text opening is content-aware rather than purely extension-driven.

Known text file types can route directly to the Text Viewer, while unknown or
extensionless files can be probed before routing. Files whose sampled bytes are
plausibly textual can therefore be opened even when Linux gives them no useful
filename extension.

Binary resources are not forced through the Text Viewer.

The Text Viewer supports bounded reading and visibly reports truncation when the
resource exceeds the safe read boundary.

## Image Resources

Core includes a generic Image Viewer for local image resources.

Image presentation supports:

- resource-aware image routing
- content-sensitive preferred opening geometry
- sensible minimum presentation size for tiny images
- bounded initial sizing for large images
- local wheel interaction owned by the viewer

Resource-specific preferred geometry does not overwrite the user's remembered
presentation preference for unrelated resources.

## Appearance

Workspace appearance is controlled through Core-owned theme infrastructure.

Current facilities include:

- dark and light modes
- multiple theme presets
- semantic colour tokens
- advanced colour overrides
- adjustable font family
- adjustable font size
- workspace scale controls
- grid visibility
- workspace-native select controls
- workspace-native numeric controls
- workspace-native colour selection

Generic controls are themed by Workspace rather than falling back to unrelated
native browser/WebKit colours.

The repository includes theme presets used to verify that generic Workspace
surfaces remain theme-correct across substantially different palettes.

## Persistence

Workspace state is persisted deterministically and repaired on load where
possible.

Persisted state includes presentation concerns such as:

- tabs
- panel instances
- committed panel geometry
- canvas bounds
- camera state
- appearance preferences
- surface presentation memory
- focus ordering

Transient runtime truth remains outside the persistence model.

Unknown or temporarily unavailable panels degrade into a recoverable missing
state rather than destroying their persisted identity.

## Resource Opening

Core exposes a generic resource-opening path so panels and modules can request
that another resource be presented without directly owning shell behavior.

Resource opening separates:

- resource identity
- preferred panel/module routing
- preferred initial geometry
- existing-resource reuse
- remembered presentation geometry

This allows File Browser, semantic links, and future modules to share the same
workspace-level presentation machinery.

## Technology

The current implementation uses:

- React 19
- TypeScript 5.8
- Vite 7
- Tauri 2
- Rust for native host/filesystem operations

Core intentionally avoids introducing a heavy application state-management
framework where deterministic local ownership is sufficient.

## Development

Install JavaScript dependencies:

    npm install

Run the frontend development server:

    npm run dev -- --host 127.0.0.1

Typecheck:

    npm run typecheck

Run the Core regression suite:

    npm run test:core

Build the production frontend:

    npm run build

Additional native-control guards are available through:

    npm run test:native-number-guard
    npm run test:native-select-guard

### Native Linux development

Workspace Core is a Tauri desktop application and therefore also requires the
appropriate Rust/Tauri and Linux native development environment.

A clean-machine Linux installation procedure will be documented after the
0.3.0 release-candidate reproducibility test. Until that procedure has been
verified from a fresh machine, this README intentionally does not claim an
untested distribution-specific dependency recipe.

## Repository Structure

    src/core/        Workspace contracts, state, persistence, controllers,
                     resource semantics, geometry and generic primitives

    src/workspace/   Workspace canvas, panel frame and projection hosting

    src/panels/      Core-owned generic panels and demonstration panels

    src/bootstrap/   Runtime/module bootstrap

    src-tauri/       Native Tauri/Rust host and filesystem boundary

    docs/contracts/  Canonical architecture contracts

    docs/devlog/     Chronological implementation records

    docs/investigations/
                     Architectural investigations and historical analysis

## Current 0.3.0 Release-Candidate Focus

The 0.3.0 development line has concentrated on promoting mature generic
Workspace behavior into Core and hardening it as reusable infrastructure.

Major areas include:

- semantic frame architecture
- settings and presentation memory
- deterministic panel placement
- logical workspace screenshots
- tab-local viewport/camera state
- theme and colour infrastructure
- workspace-native controls
- spatial navigation
- generic image presentation
- native filesystem browsing
- recursive filesystem search
- semantic/content-aware text resources
- content-aware preferred panel sizing
- native resize/camera hardening

The next release gate is reproducibility: cloning the public repositories onto
a separate Linux machine and proving that Workspace Core and Workspace Lab can
be built and run from repository state rather than relying on local development
history.

## Non-Goals

Workspace Core is not intended to be:

- a webpage dashboard framework
- a traditional IDE clone
- a source of application/domain truth
- a dumping ground for Jarri-specific integrations
- an operating system
- a replacement for domain services

It is the reusable cognitive workspace layer on which those applications can
project their own capabilities.

## License

MIT
