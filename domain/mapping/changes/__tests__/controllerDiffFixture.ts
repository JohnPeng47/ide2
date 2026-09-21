/** The controller diagram used in the user-visible three-change demo. */
const prefix = [
  '[D] Controller edits / agent access',
  '|',
  '|-- UI -> MappingDocumentController',
  '|   |-- commitDocument(...)    grid edits',
  '|   |-- updateCanvas(...)     pane/control state',
  '|   `-- undo(redo = false)    document + canvas history',
  '|',
  '`-- Agent -> MCP -> HTTP backend'
];
const suffix = ['', 'Source: mappingDocumentController.ts; sessionService.ts'];
export const controllerBefore = [...prefix,
  '    `-- AgentDiagrammingSessionService',
  '        `-- CanvasSessionBridge -> browser poll/reply',
  '            `-- transact(expectedVersion, operations[])',
  '                |-- draw / replace / move / collapse / remove',
  '                |-- clone + validate + layout',
  '                `-- publish -> floating layout -> one undo',
  '',
  'exec: synchronous QuickJS canvas/nodes methods.',
  'diagram-search: search + full saved/live reads.',
  'canvas-api-search: documentation, not drawn objects.',
  'save_diagram: catalog revision -> explorer + search.',
  '',
  'UI shares history; not all edits use transact validation.',
  'Measurements do not add undo entries or bump version.',
  'Live edits require an open Mapping page.',
  ...suffix
].join('\n');
export const controllerPatch = [
  '    `-- AgentDiagrammingSessionService',
  '        |-- no changeSessionId',
  '        |   `-- bridge -> live browser controller',
  '        `-- changeSessionId',
  '            `-- ChangeSessionService',
  '                `-- proposed document controller',
  '',
  'Session edits (preview copies)',
  '|-- nodes.patchDiagram(start, end, patch)',
  '|-- nodes.draw(...) + edges.create(...)',
  '`-- undo / redo / reset',
  '',
  'Original / Proposed switches the preview snapshot.',
  'Session edits persist without saving originals.',
  'Acceptance into originals is a future step.'
].join('\n');
export const expectedAddedLabels = ['no changeSessionId', 'bridge -> live browser controller', 'changeSessionId',
  'ChangeSessionService', 'proposed document controller', 'Session edits (preview copies)',
  'nodes.patchDiagram(start, end, patch)', 'nodes.draw(...) + edges.create(...)', 'undo / redo / reset'];
export const expectedUnchangedLabels = ['UI -> MappingDocumentController', 'commitDocument(...)    grid edits',
  'updateCanvas(...)     pane/control state', 'undo(redo = false)    document + canvas history'];
