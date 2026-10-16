import { useState } from "react";
import { Section } from "../components/Section";
import { BLOCKS, DEFAULT_BLOCK, STAGES, VIEWBOX, VOP_NOTE } from "../content/architecture";
import { BlockDetail } from "./BlockDetail";
import { BlockDiagram } from "./BlockDiagram";
import { BlockTable } from "./BlockTable";
import { findBlock } from "./layout";
import { Stepper } from "./Stepper";
import { KIND_LABEL, KINDS } from "./types";

export function ArchitectureSection() {
  const [selected, setSelected] = useState(DEFAULT_BLOCK);
  const block = findBlock(BLOCKS, selected);

  return (
    <Section
      id="architecture"
      title="The chip"
      headline="A mesh of GEMM tiles behind one command processor, with a vector unit beside it."
      drawer={{
        summary: "Go deeper",
        body: (
          <div>
            <h3>Follow one BLOCK through the chip</h3>
            <Stepper stages={STAGES} selected={selected} onSelect={setSelected} note={VOP_NOTE} />
            <h3>Every block</h3>
            <BlockTable blocks={BLOCKS} />
          </div>
        ),
      }}
    >
      <div className="arch-layout">
        <div>
          <BlockDiagram blocks={BLOCKS} viewBox={VIEWBOX} selected={selected} onSelect={setSelected} />
          <ul className="arch-legend" aria-label="Block kinds">
            {KINDS.map((kind) => (
              <li key={kind}>
                <span className="swatch" style={{ background: `var(--kind-${kind})` }} />
                {KIND_LABEL[kind]}
              </li>
            ))}
          </ul>
        </div>
        <BlockDetail block={block} />
      </div>
    </Section>
  );
}
