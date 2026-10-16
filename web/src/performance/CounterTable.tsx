import { formatInt, formatPercent, formatRatio } from "../format";
import { performance } from "./data";
import type { MeshPerf } from "./types";

const pct = (x: number) => formatPercent(x, 1);

function PortCells({ m }: { m: MeshPerf }) {
  const s = m.port.shares;
  return (
    <>
      <td>{pct(s.operand)}</td>
      <td>{pct(s.go)}</td>
      <td>{pct(s.stall)}</td>
      <td>{pct(s.wait)}</td>
      <td>{pct(s.credit)}</td>
      <td>{pct(s.other)}</td>
    </>
  );
}

export function CounterTable() {
  const { cifar, lm } = performance;
  const c4 = lm.categories2x2;
  return (
    <div>
      <div className="table-scroll">
        <table className="data-table">
          <caption>CIFAR-10, 128 images per mesh, one start pulse</caption>
          <thead>
            <tr>
              <th>Mesh</th>
              <th>Cycles per image</th>
              <th>Speedup</th>
              <th>MAC util per tile</th>
              <th>Corner busy</th>
              <th>Corner stalled</th>
              <th>OPERAND</th>
              <th>GO</th>
              <th>Stall</th>
              <th>WAIT/END</th>
              <th>Credit</th>
              <th>Other</th>
            </tr>
          </thead>
          <tbody>
            {cifar.meshes.map((m) => (
              <tr key={m.mesh}>
                <td>{m.mesh}</td>
                <td>{formatInt(m.cyclesPerUnit)}</td>
                <td>{formatRatio(m.speedup)}</td>
                <td>{pct(m.macUtilization)}</td>
                <td>{pct(m.cornerBusy)}</td>
                <td>{pct(m.cornerStalled)}</td>
                <PortCells m={m} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="counter-note">
        "Other" is 106 cycles per image on every mesh: the command processor's non-BLOCK commands and the DMA refilling after each WAIT.
        Below saturation a single tile cannot overlap loading and computing, which is why 1x1 stalls the port {pct(cifar.meshes[0]!.cornerStalled)} of its cycles.
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <caption>Link occupancy at node (0,0), CIFAR-10</caption>
          <thead>
            <tr>
              <th>Mesh</th>
              <th>East link</th>
              <th>North link</th>
              <th>LOCAL out</th>
            </tr>
          </thead>
          <tbody>
            {cifar.meshes.map((m) => (
              <tr key={m.mesh}>
                <td>{m.mesh}</td>
                <td>{pct(m.links.east)}</td>
                <td>{pct(m.links.north)}</td>
                <td>{pct(m.links.local)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <caption>Story model, 256 steps at temperature 1.0</caption>
          <thead>
            <tr>
              <th>Mesh</th>
              <th>Cycles</th>
              <th>Cycles per step</th>
              <th>Speedup</th>
              <th>MAC util per tile</th>
              <th>Corner busy</th>
              <th>OPERAND</th>
              <th>GO</th>
              <th>Stall</th>
              <th>WAIT, END or VPU</th>
              <th>Credit</th>
              <th>Other</th>
            </tr>
          </thead>
          <tbody>
            {lm.meshes.map((m) => (
              <tr key={m.mesh}>
                <td>{m.mesh}</td>
                <td>{formatInt(m.cycles)}</td>
                <td>{formatInt(m.cyclesPerUnit)}</td>
                <td>{formatRatio(m.speedup)}</td>
                <td>{pct(m.macUtilization)}</td>
                <td>{pct(m.cornerBusy)}</td>
                <PortCells m={m} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <caption>Story model, 2x2: what each cycle was spent on (measured for the 2x2 run only)</caption>
          <thead>
            <tr>
              <th>Category</th>
              <th>Cycles</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Weight matmuls", "weights"],
                ["Attention", "attention"],
                ["VPU", "vpu"],
                ["Other", "other"],
              ] as const
            ).map(([label, key]) => (
              <tr key={key}>
                <td>{label}</td>
                <td>{formatInt(c4.cycles[key])}</td>
                <td>{pct(c4.shares[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="counter-note">
        The run's {formatInt(lm.meshes[1]!.cycles)} cycles include {formatInt(c4.tail)} that come after the final token.
        The VPU's {formatInt(lm.vpuCycles)} busy cycles are the same on every mesh, and they sit inside the WAIT column of the port partition.
      </p>
    </div>
  );
}
