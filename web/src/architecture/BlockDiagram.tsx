import { memo } from "react";
import { edges, findBlock, linkSegment } from "./layout";
import { KIND_LABEL, type Block } from "./types";

/** A block's tint never exceeds MAX_TINT of its kind color, which keeps the label AA (tokens.test.ts checks it). */
const TINT = 0.3;

export const BlockDiagram = memo(function BlockDiagram({
  blocks,
  viewBox,
  selected,
  onSelect,
}: {
  blocks: Block[];
  viewBox: { w: number; h: number };
  selected: string;
  onSelect(id: string): void;
}) {
  const pairs = edges(blocks);
  const label =
    "Accelerator block diagram. Connections: " +
    pairs.map(([a, b]) => `${findBlock(blocks, a).name} to ${findBlock(blocks, b).name}`).join("; ") +
    ".";

  return (
    <svg className="arch-diagram" viewBox={`0 0 ${viewBox.w} ${viewBox.h}`} role="group" aria-label={label}>
      {pairs.map(([a, b]) => {
        const s = linkSegment(findBlock(blocks, a).box, findBlock(blocks, b).box);
        return <line key={`${a}-${b}`} className="arch-link" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
      })}
      {blocks.map((block) => {
        const { x, y, w, h } = block.box;
        const isSelected = block.id === selected;
        return (
          <g
            key={block.id}
            className={`arch-block kind-${block.kind}${isSelected ? " arch-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${block.name}, ${KIND_LABEL[block.kind]}`}
            data-block={block.id}
            onClick={() => onSelect(block.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(block.id);
              }
            }}
          >
            <rect className="arch-bg" x={x} y={y} width={w} height={h} rx={8} />
            <rect className="arch-tint" x={x} y={y} width={w} height={h} rx={8} fillOpacity={TINT} />
            <text className="arch-label" x={x + w / 2} y={y + h / 2 + 5}>
              {block.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});
