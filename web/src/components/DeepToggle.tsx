export function DeepToggle({ deep, onChange }: { deep: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" className="deep-toggle" aria-pressed={deep} onClick={() => onChange(!deep)}>
      Deep mode
    </button>
  );
}
