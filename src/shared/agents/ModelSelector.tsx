import { DIAGRAM_MODELS, type DiagramModelId } from "../../../domain/core/records/domain";

export function ModelSelector(props: {
  id: string;
  value: DiagramModelId;
  disabled: boolean;
  onChange: (value: DiagramModelId) => void;
}) {
  return (
    <label className="model-field" htmlFor={props.id}>
      <span>MODEL</span>
      <select
        id={props.id}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value as DiagramModelId)}
      >
        {DIAGRAM_MODELS.map((model) => (
          <option value={model.id} key={model.id}>{model.label}</option>
        ))}
      </select>
    </label>
  );
}
