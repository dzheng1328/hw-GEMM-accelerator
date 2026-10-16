export function MeshSelector({
  meshes,
  selected,
  onSelect,
}: {
  meshes: string[];
  selected: string;
  onSelect(mesh: string): void;
}) {
  return (
    <div className="mesh-selector" role="group" aria-label="Mesh size">
      {meshes.map((mesh) => (
        <button key={mesh} type="button" aria-pressed={mesh === selected} onClick={() => onSelect(mesh)}>
          {mesh}
        </button>
      ))}
    </div>
  );
}
