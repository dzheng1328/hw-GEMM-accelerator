import { MESH_KEYS, type MeshKey } from "../sim/types";

const LABELS: Record<MeshKey, string> = { "1x1": "1x1 (1 tile)", "2x2": "2x2 (4 tiles)", "4x4": "4x4 (16 tiles)" };

export interface MeshChoiceProps {
  value: MeshKey;
  onChange(mesh: MeshKey): void;
  disabled?: boolean;
}

export function MeshChoice({ value, onChange, disabled }: MeshChoiceProps) {
  return (
    <fieldset className="live-mesh" disabled={disabled}>
      <legend>Mesh size</legend>
      {MESH_KEYS.map((key) => (
        <label key={key}>
          <input type="radio" name="live-mesh" value={key} checked={value === key} onChange={() => onChange(key)} /> {LABELS[key]}
        </label>
      ))}
    </fieldset>
  );
}
