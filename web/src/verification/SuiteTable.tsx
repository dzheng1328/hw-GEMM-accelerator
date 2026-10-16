import type { Layer, Suite } from "./types";

export function SuiteTable({ suites, layers }: { suites: Suite[]; layers: Layer[] }) {
  const failing = suites.flatMap((suite) =>
    suite.checks.filter((check) => check.kind === "must-fail").map((check) => ({ suite, check })),
  );
  return (
    <div>
      {layers.map((layer) => (
        <div className="table-scroll" key={layer}>
          <table className="data-table suite-table" role="table">
            <caption>{layer}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Suite</th>
                <th role="columnheader">Under test</th>
                <th role="columnheader">What it proves</th>
                <th role="columnheader">Checks</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {suites
                .filter((suite) => suite.layer === layer)
                .map((suite) => (
                  <tr key={suite.dir} role="row">
                    <td role="cell" data-label="Suite">
                      <code>{suite.dir}</code>
                    </td>
                    <td role="cell" data-label="Under test">
                      {suite.dut.map((file) => (
                        <code key={file}>{file}</code>
                      ))}
                    </td>
                    <td role="cell" data-label="What it proves">{suite.proves}</td>
                    <td role="cell" data-label="Checks">
                      {suite.checks.map((check) => (
                        <code key={check.target}>
                          make {check.target} ({check.kind === "must-fail" ? "must fail" : "must hold"})
                        </code>
                      ))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <h3>Must fail, and does</h3>
      <ul className="must-fail">
        {failing.map(({ suite, check }) => (
          <li key={`${suite.dir}:${check.target}`}>
            <code>make {check.target}</code> in {suite.dir}: {check.says}
          </li>
        ))}
      </ul>
    </div>
  );
}
