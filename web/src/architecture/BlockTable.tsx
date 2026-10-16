import { KIND_LABEL, type Block } from "./types";

export function BlockTable({ blocks }: { blocks: Block[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table suite-table">
        <caption>Every block, with the files that implement it and the suites that test it</caption>
        <thead>
          <tr>
            <th>Block</th>
            <th>Kind</th>
            <th>RTL</th>
            <th>Tests</th>
            <th>Number</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block.id}>
              <td>{block.name}</td>
              <td>{KIND_LABEL[block.kind]}</td>
              <td>
                {block.rtl.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </td>
              <td>
                {block.suites.map((suite) => (
                  <code key={suite.dir}>
                    {suite.dir}
                    {suite.targets.length ? ` (${suite.targets.map((t) => `make ${t}`).join(", ")})` : ""}
                  </code>
                ))}
              </td>
              <td>
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
