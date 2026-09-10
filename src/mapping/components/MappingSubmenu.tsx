export function MappingSubmenu(props: {
  projectName: string; name: string; status: string; canSave: boolean;
  onNameChange: (name: string) => void; onNew: () => void; onSave: () => void;
}) {
  return <div className="mapping-submenu" aria-label="Mapping submenu">
    <div><span>{props.projectName}</span><input aria-label="Diagram name" value={props.name}
      placeholder="Project diagrams" maxLength={120} onChange={(event) => props.onNameChange(event.target.value)} /></div>
    <button type="button" onClick={props.onNew}>New</button>
    <button type="button" onClick={props.onSave} disabled={!props.canSave}>Save</button>
    <small role="status">{props.status}</small>
  </div>;
}
