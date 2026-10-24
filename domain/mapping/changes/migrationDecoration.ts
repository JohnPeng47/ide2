export interface MigrationMark { id: string; role: 'source' | 'destination'; title: string }
export const migrationMarkKey = (displayNodeId: string, contentNodeId: string) => JSON.stringify([displayNodeId, contentNodeId]);
