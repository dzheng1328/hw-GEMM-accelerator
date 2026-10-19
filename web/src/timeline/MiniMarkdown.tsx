import { Fragment, type ReactNode } from "react";
import { parseBlocks, parseInline, type Block, type Inline } from "./markdown";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "strong":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
    }
  });
}

/** Inline markdown only (code, bold, italics), for a heading or a note. */
export function Inlines({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return <p>{renderInline(parseInline(block.text))}</p>;
    case "ul":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(parseInline(item))}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(parseInline(item))}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} style={{ textAlign: block.align[c] }}>
                    {renderInline(parseInline(cell))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ textAlign: block.align[c] }}>
                      {renderInline(parseInline(cell))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Renders the markdown subset the decision entries use as React elements. It never injects HTML. */
export function MiniMarkdown({ source }: { source: string }) {
  return (
    <div className="md">
      {parseBlocks(source).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
