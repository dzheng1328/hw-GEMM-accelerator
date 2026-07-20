`timescale 1ns / 1ps

// rtl/router.v -- a single 2D-mesh NoC router. First Phase 2 NoC increment:
// the block that, replicated at every tile, moves operand payloads between
// tiles. Verified standalone here (tb/router/); wiring a mesh of these to real
// tiles is a later card.
//
// This is "new territory" vs the datapath work: it is control/steering logic,
// not arithmetic. Three standard pieces:
//   * Routing:     XY dimension-order routing (route in X first, then Y). This
//                  is the textbook deadlock-free choice for a mesh.
//   * Arbitration: one round-robin arbiter per output port, so when several
//                  inputs want the same output no input can starve.
//   * Flow control: a per-port valid/ready handshake with backpressure -- an
//                  output that is not ready holds its input off.
//
// Five ports, indexed LOCAL/NORTH/EAST/SOUTH/WEST. LOCAL is the attached tile;
// the other four are the mesh neighbours. Coordinates increase EAST (+x) and
// NORTH (+y). The router is combinational (single-cycle crossbar, no internal
// buffering) -- the simplest correct form. NOTE for the mesh-integration card:
// connecting out ports straight to neighbours' in ports would create
// combinational cycles, so that step must register flits at the inputs (a skid
// buffer) to break them; not needed for this standalone block.
//
// Flit layout (single-flit packets): { payload[PW-1:0], dest_y[AW-1:0],
// dest_x[AW-1:0] } with dest_x in the low bits. The payload is opaque here;
// when integrated it carries an addressed operand slot for a tile's
// operand_mem write port ({wr_addr, wr_a_col, wr_b_row}).
module router #(
    parameter AW = 2,               // bits per mesh coordinate (AW=2 -> up to 4x4)
    parameter PW = 64,              // payload width
    parameter FW = PW + 2*AW,       // derived flit width -- do not override
    parameter NP = 5                // ports -- fixed by the mesh, do not override
) (
    input  wire                clk,
    input  wire                rst,
    input  wire [AW-1:0]       my_x,      // this router's mesh X (tie-off per instance)
    input  wire [AW-1:0]       my_y,      // this router's mesh Y (tie-off per instance)
    input  wire [NP-1:0]       in_valid,
    input  wire [NP*FW-1:0]    in_flit,
    output wire [NP-1:0]       in_ready,
    output wire [NP-1:0]       out_valid,
    output wire [NP*FW-1:0]    out_flit,
    input  wire [NP-1:0]       out_ready
);

    localparam LOCAL = 0, NORTH = 1, EAST = 2, SOUTH = 3, WEST = 4;

    // ---- Unpack flits, pull out destination coordinates ----
    wire [FW-1:0] iflit [0:NP-1];
    wire [AW-1:0] dst_x [0:NP-1];
    wire [AW-1:0] dst_y [0:NP-1];
    genvar gp;
    generate
        for (gp = 0; gp < NP; gp = gp + 1) begin : unpack
            assign iflit[gp] = in_flit[gp*FW +: FW];
            assign dst_x[gp] = iflit[gp][AW-1:0];
            assign dst_y[gp] = iflit[gp][2*AW-1:AW];
        end
    endgenerate

    // ---- Route computation: XY dimension-order, one output port per input ----
    reg [2:0] dest_port [0:NP-1];
    integer ii;
    always @* begin
        for (ii = 0; ii < NP; ii = ii + 1) begin
            if      (dst_x[ii] > my_x) dest_port[ii] = EAST;
            else if (dst_x[ii] < my_x) dest_port[ii] = WEST;
            else if (dst_y[ii] > my_y) dest_port[ii] = NORTH;
            else if (dst_y[ii] < my_y) dest_port[ii] = SOUTH;
            else                       dest_port[ii] = LOCAL;   // arrived
        end
    end

    // ---- Per-output round-robin arbitration ----
    // rr[o] is the input index that currently has highest priority for output o.
    // Scanning from rr[o] and granting the first requester gives round-robin
    // fairness once rr advances past each winner.
    reg [2:0] rr        [0:NP-1];
    reg       grant_vld [0:NP-1];
    reg [2:0] grant_idx [0:NP-1];
    integer oo, kk, idx;
    always @* begin
        for (oo = 0; oo < NP; oo = oo + 1) begin
            grant_vld[oo] = 1'b0;
            grant_idx[oo] = 3'd0;
            for (kk = 0; kk < NP; kk = kk + 1) begin
                idx = rr[oo] + kk;
                if (idx >= NP) idx = idx - NP;
                if (!grant_vld[oo] && in_valid[idx] && (dest_port[idx] == oo)) begin
                    grant_vld[oo] = 1'b1;
                    grant_idx[oo] = idx[2:0];
                end
            end
        end
    end

    // ---- Crossbar + handshake ----
    generate
        for (gp = 0; gp < NP; gp = gp + 1) begin : xbar
            // Output offers the granted input's flit.
            assign out_valid[gp]           = grant_vld[gp];
            assign out_flit[gp*FW +: FW]   = iflit[grant_idx[gp]];
            // An input is accepted only when the output it wants granted *it*
            // and that output's downstream is ready (backpressure).
            assign in_ready[gp] = in_valid[gp]
                                && grant_vld[dest_port[gp]]
                                && (grant_idx[dest_port[gp]] == gp[2:0])
                                && out_ready[dest_port[gp]];
        end
    endgenerate

    // ---- Advance each output's round-robin pointer on a completed transfer ----
    integer op;
    always @(posedge clk) begin
        if (rst) begin
            for (op = 0; op < NP; op = op + 1) rr[op] <= 3'd0;
        end else begin
            for (op = 0; op < NP; op = op + 1) begin
                if (grant_vld[op] && out_ready[op]) begin
                    rr[op] <= (grant_idx[op] == NP-1) ? 3'd0 : grant_idx[op] + 3'd1;
                end
            end
        end
    end

endmodule
