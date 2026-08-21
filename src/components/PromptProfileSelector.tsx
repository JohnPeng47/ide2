import {
  type GenerationPromptProfileId,
  type SystemPromptTemplateRecord
} from "../domain";

export function PromptProfileSelector(props: {
  id: string;
  templates: SystemPromptTemplateRecord[];
  value: GenerationPromptProfileId;
  disabled: boolean;
  onChange: (value: GenerationPromptProfileId) => void;
}) {
  return (
    <label className="model-field" htmlFor={props.id}>
      <span>SYSTEM STYLE</span>
      <select
        id={props.id}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value as GenerationPromptProfileId)}
      >
        {props.templates.map((profile) => (
          <option value={profile.id} key={profile.id}>{profile.label}</option>
        ))}
      </select>
    </label>
  );
}
