import { KIND_LABEL, type Block } from "./types";

export function BlockTable({ blocks }: { blocks: Block[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table suite-table" role="table">
        <caption>Every block, with the files that implement it and the suites that test it</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">Block</th>
            <th role="columnheader">Kind</th>
            <th role="columnheader">RTL</th>
            <th role="columnheader">Tests</th>
            <th role="columnheader">Number</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {blocks.map((block) => (
            <tr key={block.id} role="row">
              <td role="cell" data-label="Block">{block.name}</td>
              <td role="cell" data-label="Kind">{KIND_LABEL[block.kind]}</td>
              <td role="cell" data-label="RTL">
                {block.rtl.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </td>
              <td role="cell" data-label="Tests">
                {block.suites.map((suite) => (
                  <code key={suite.dir}>
                    {suite.dir}
                    {suite.targets.length ? ` (${suite.targets.map((t) => `make ${t}`).join(", ")})` : ""}
                  </code>
                ))}
              </td>
              <td role="cell" data-label="Number">
                {block.number.value}
                <br />
                {block.number.label}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
