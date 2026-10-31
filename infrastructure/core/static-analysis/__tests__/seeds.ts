export const seedPaths = {
  session: 'src/features/mapping/workspace/canvasSession.ts',
  workspace: 'src/features/mapping/workspace/canvasWorkspace.ts',
  runtime: 'src/features/mapping/tldraw/CanvasRuntimeContext.tsx',
  editor: 'src/features/mapping/tldraw/MappingEditorCanvas.tsx',
  clipboard: 'src/features/mapping/canvas/cursorCopy.ts',
  overlay: 'src/features/mapping/canvas/CursorCopyOverlay.tsx',
  controller: 'domain/mapping/workspace/mappingDocumentController.ts',
} as const;
export const realSeeds = [
  { id: 'session', paths: [seedPaths.session], golden: 'session.golden.json' },
  { id: 'workspace', paths: [seedPaths.workspace, seedPaths.session], golden: 'workspace.golden.json' },
  { id: 'runtime', paths: [seedPaths.runtime, seedPaths.session, seedPaths.controller], golden: 'runtime.golden.json' },
  { id: 'react-selector', paths: [seedPaths.clipboard, seedPaths.overlay], golden: 'react-selector.golden.json' },
] as const;

export const subsystemSeed = { id: 'workspace-pipeline', paths: Object.values(seedPaths), golden: 'subsystem.golden.json' };
