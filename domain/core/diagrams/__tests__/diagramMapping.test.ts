import { describe, expect, it } from "vitest";
import type { CodeEntityRecord } from "../../records/domain";
import { diagramMappingValidationError, validateDiagramMappings } from "../diagramMapping";

const entity: CodeEntityRecord = {
  id: "entity-upload-sources",
  handle: "upload-sources",
  label: "Upload sources",
  category: "operation",
  summary: "Selects sources to upload.",
  sourceRanges: [{ path: "fixture.ts", startLine: 1, endLine: 1 }]
};

describe("diagram mapping validation", () => {
  it("reports the submitted span and raw line width for out-of-range coordinates", () => {
    const error = diagramMappingValidationError("| default_training_remote_upload_sources |", [{
      entityId: entity.id,
      sourceRangeIndex: 0,
      line: 1,
      startColumn: 9,
      endColumn: 48
    }], [entity]);

    expect(error).toBe(
      "mapping coordinates 9-48 are outside the ASCII at line 1; the line has 42 columns"
    );
  });

  it("returns application-ready mappings after validating a raw ASCII span", () => {
    expect(validateDiagramMappings("| upload_sources |", [{
      entityId: entity.id,
      sourceRangeIndex: 0,
      line: 1,
      startColumn: 3,
      endColumn: 16
    }], [entity])).toEqual([{
      id: "map-1",
      entityId: entity.id,
      sourceRangeIndex: 0,
      line: 1,
      startColumn: 3,
      endColumn: 16
    }]);
  });
});
