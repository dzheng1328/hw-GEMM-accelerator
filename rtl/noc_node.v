`timescale 1ns / 1ps

// rtl/noc_node.v -- one mesh node: a router (rtl/router.v) attached to a full
// self-sequencing GEMM tile (rtl/gemm_tile.v), with registered flit buffers
// (rtl/flit_buf.v) on every mesh-side router input to break the combinational
// cycles a raw crossbar mesh would form.
//
// Flit format (the router treats everything above the address as opaque):
//
//   { type[1:0], payload[PW-1:0], dest_y[AW-1:0], dest_x[AW-1:0] }
//
//   type 0 OPERAND  payload = {wr_addr, wr_a_col, wr_b_row} -- an addressed
//                   operand_mem write, delivered straight into the tile's
//                   write port (the interface built in the operand-mem step).
//   type 1 GO       payload[7:0] = {ret_y, ret_x, k_chunks} -- a compute
//                   descriptor: pulses the tile's start with k_chunks, and
//                   arms the result-return engine with a RETURN ADDRESS.
//   type 2 RESULT   payload[41:0] = {src_y, src_x, idx, acc32} -- one
//                   accumulator cell, streamed back to the GO's return
//                   address when the tile finishes. Delivered at the
//                   destination on the res_* ports (a host-side interface).
//
// With GO and RESULT flits, a tile's entire life cycle -- load operands,
// kick off compute, collect the 8x8 result -- rides the network; no
// per-tile control wires are required. Ordering is guaranteed per
// source-destination pair (XY routing is single-path and every link is a
// FIFO), so a GO sent after its operands can never overtake them.
//
// The result-return engine shares the router's LOCAL input with the external
// injection port (result flits have priority; injection is held off via the
// ready handshake while streaming -- 64 cycles-ish, bounded). The direct
// start/k_chunks/busy/done/acc_out ports remain functional alongside the
// packetized path (used by the earlier testbenches; a GO is just another way
// to pulse start).
module noc_node #(
    parameter N    = 8,
    parameter KMAX = 8,
    parameter AW   = 2,
    // Must match pe.v's real accumulate latency (rtl/pe.v's ACC_LATENCY
    // localparam). Sites that must stay in sync if that value ever changes:
    // rtl/pe.v's ACC_LATENCY localparam (the source of truth),
    // rtl/gemm_sequencer.v's PE_ACC_LATENCY default, rtl/gemm_tile.v's
    // PE_ACC_LATENCY default, and this default (threaded into the
    // gemm_tile instantiation below, following the same pattern as N/KMAX).
    parameter PE_ACC_LATENCY = 2,
    // Derived -- do not override.
    parameter ADDRW = 6,               // $clog2(N*KMAX) for the defaults
    parameter PW    = ADDRW + 16*N,    // operand payload = 134 bits (widest)
    parameter TW    = 2,               // flit type field
    parameter FW    = TW + PW + 2*AW   // 140
) (
    input  wire            clk,
    input  wire            rst,
    input  wire [AW-1:0]   my_x,
    input  wire [AW-1:0]   my_y,

    // Local injection port (into the network).
    input  wire            lcl_in_valid,
    input  wire [FW-1:0]   lcl_in_flit,
    output wire            lcl_in_ready,

    // Mesh links, one set per direction. *_in feeds this node's input buffer;
    // *_out comes straight off the router (the neighbour's buffer registers it).
    input  wire            n_in_valid,  input  wire [FW-1:0] n_in_flit,  output wire n_in_ready,
    output wire            n_out_valid, output wire [FW-1:0] n_out_flit, input  wire n_out_ready,
    input  wire            e_in_valid,  input  wire [FW-1:0] e_in_flit,  output wire e_in_ready,
    output wire            e_out_valid, output wire [FW-1:0] e_out_flit, input  wire e_out_ready,
    input  wire            s_in_valid,  input  wire [FW-1:0] s_in_flit,  output wire s_in_ready,
    output wire            s_out_valid, output wire [FW-1:0] s_out_flit, input  wire s_out_ready,
    input  wire            w_in_valid,  input  wire [FW-1:0] w_in_flit,  output wire w_in_ready,
    output wire            w_out_valid, output wire [FW-1:0] w_out_flit, input  wire w_out_ready,

    // Delivered RESULT flits (host-side interface; valid for one cycle each).
    output wire            res_valid,
    output wire [AW-1:0]   res_src_x,
    output wire [AW-1:0]   res_src_y,
    output wire [5:0]      res_idx,
    output wire [31:0]     res_acc,

    // Direct tile control/status -- still functional alongside GO flits.
    input  wire            start,
    input  wire [3:0]      k_chunks,
    output wire            busy,
    output wire            done,
    output wire signed [32*N*N-1:0] acc_out
);

    localparam LOCAL = 0, NORTH = 1, EAST = 2, SOUTH = 3, WEST = 4;
    localparam NP = 5;
    localparam [1:0] T_OPR = 2'd0, T_GO = 2'd1, T_RES = 2'd2;

    // ---- Input buffers on the four mesh ports ----
    wire [3:0]      buf_valid;
    wire [FW-1:0]   buf_flit  [0:3];
    wire [3:0]      buf_ready;

    flit_buf #(.FW(FW)) buf_n (.clk(clk), .rst(rst),
        .in_valid(n_in_valid), .in_flit(n_in_flit), .in_ready(n_in_ready),
        .out_valid(buf_valid[0]), .out_flit(buf_flit[0]), .out_ready(buf_ready[0]));
    flit_buf #(.FW(FW)) buf_e (.clk(clk), .rst(rst),
        .in_valid(e_in_valid), .in_flit(e_in_flit), .in_ready(e_in_ready),
        .out_valid(buf_valid[1]), .out_flit(buf_flit[1]), .out_ready(buf_ready[1]));
    flit_buf #(.FW(FW)) buf_s (.clk(clk), .rst(rst),
        .in_valid(s_in_valid), .in_flit(s_in_flit), .in_ready(s_in_ready),
        .out_valid(buf_valid[2]), .out_flit(buf_flit[2]), .out_ready(buf_ready[2]));
    flit_buf #(.FW(FW)) buf_w (.clk(clk), .rst(rst),
        .in_valid(w_in_valid), .in_flit(w_in_flit), .in_ready(w_in_ready),
        .out_valid(buf_valid[3]), .out_flit(buf_flit[3]), .out_ready(buf_ready[3]));

    // ---- Router (the {type, payload} pair is opaque to it) ----
    wire [NP-1:0]    r_in_valid, r_in_ready, r_out_valid, r_out_ready;
    wire [NP*FW-1:0] r_in_flit, r_out_flit;

    // Result-return engine state (declared early: it muxes the LOCAL input).
    reg  [1:0]      rr_state;   // 0 idle / 1 wait-fall / 2 wait-rise / 3 stream
    reg  [6:0]      rr_idx;
    reg  [AW-1:0]   rr_ret_x, rr_ret_y;
    wire            rr_streaming = (rr_state == 2'd3);
    wire [31:0]     rr_acc = acc_out[32*rr_idx +: 32];
    wire [PW-1:0]   rr_payload = { {(PW-42){1'b0}}, my_y, my_x, rr_idx[5:0], rr_acc };
    wire [FW-1:0]   rr_flit = { T_RES, rr_payload, rr_ret_y, rr_ret_x };

    assign r_in_valid[LOCAL]         = rr_streaming ? 1'b1    : lcl_in_valid;
    assign r_in_flit[LOCAL*FW +: FW] = rr_streaming ? rr_flit : lcl_in_flit;
    assign lcl_in_ready              = rr_streaming ? 1'b0    : r_in_ready[LOCAL];
    wire   rr_accept                 = rr_streaming && r_in_ready[LOCAL];

    assign r_in_valid[NORTH] = buf_valid[0];
    assign r_in_valid[EAST]  = buf_valid[1];
    assign r_in_valid[SOUTH] = buf_valid[2];
    assign r_in_valid[WEST]  = buf_valid[3];
    assign r_in_flit[NORTH*FW +: FW] = buf_flit[0];
    assign r_in_flit[EAST*FW  +: FW] = buf_flit[1];
    assign r_in_flit[SOUTH*FW +: FW] = buf_flit[2];
    assign r_in_flit[WEST*FW  +: FW] = buf_flit[3];
    assign buf_ready[0] = r_in_ready[NORTH];
    assign buf_ready[1] = r_in_ready[EAST];
    assign buf_ready[2] = r_in_ready[SOUTH];
    assign buf_ready[3] = r_in_ready[WEST];

    router #(.AW(AW), .PW(TW + PW)) rt (
        .clk(clk), .rst(rst),
        .my_x(my_x), .my_y(my_y),
        .in_valid(r_in_valid), .in_flit(r_in_flit), .in_ready(r_in_ready),
        .out_valid(r_out_valid), .out_flit(r_out_flit), .out_ready(r_out_ready)
    );

    assign n_out_valid = r_out_valid[NORTH];
    assign e_out_valid = r_out_valid[EAST];
    assign s_out_valid = r_out_valid[SOUTH];
    assign w_out_valid = r_out_valid[WEST];
    assign n_out_flit = r_out_flit[NORTH*FW +: FW];
    assign e_out_flit = r_out_flit[EAST*FW  +: FW];
    assign s_out_flit = r_out_flit[SOUTH*FW +: FW];
    assign w_out_flit = r_out_flit[WEST*FW  +: FW];
    assign r_out_ready[NORTH] = n_out_ready;
    assign r_out_ready[EAST]  = e_out_ready;
    assign r_out_ready[SOUTH] = s_out_ready;
    assign r_out_ready[WEST]  = w_out_ready;

    // ---- LOCAL delivery: decode by flit type ----
    wire [FW-1:0] lflit   = r_out_flit[LOCAL*FW +: FW];
    wire [1:0]    ltype   = lflit[FW-1 -: TW];
    wire [PW-1:0] payload = lflit[2*AW +: PW];
    wire          deliver = r_out_valid[LOCAL];
    assign r_out_ready[LOCAL] = 1'b1;   // every delivery consumed in one cycle

    // OPERAND -> operand_mem write.
    wire                 wr_en    = deliver && (ltype == T_OPR);
    wire [8*N-1:0]       wr_b_row = payload[8*N-1 : 0];
    wire [8*N-1:0]       wr_a_col = payload[16*N-1 : 8*N];
    wire [ADDRW-1:0]     wr_addr  = payload[PW-1 : 16*N];

    // RESULT -> host-side ports (one cycle per flit).
    assign res_valid = deliver && (ltype == T_RES);
    assign res_acc   = payload[31:0];
    assign res_idx   = payload[37:32];
    assign res_src_x = payload[38 +: AW];
    assign res_src_y = payload[38+AW +: AW];

    // GO -> registered start pulse + latched descriptor, arms result return.
    wire go_deliver = deliver && (ltype == T_GO);
    reg        go_pulse;
    reg [3:0]  go_k;
    always @(posedge clk) begin
        if (rst) begin
            go_pulse <= 1'b0;
            go_k     <= 4'd0;
            rr_ret_x <= {AW{1'b0}};
            rr_ret_y <= {AW{1'b0}};
        end else begin
            go_pulse <= 1'b0;
            if (go_deliver) begin
                go_k     <= payload[3:0];
                rr_ret_x <= payload[4 +: AW];
                rr_ret_y <= payload[4+AW +: AW];
                go_pulse <= 1'b1;
            end
        end
    end

    // ---- Result-return engine ----
    // Armed by a GO; waits for the tile's (level-held) done to fall as the
    // new run starts, then rise when it completes, then streams all N*N
    // accumulator cells to the return address via the LOCAL input mux.
    always @(posedge clk) begin
        if (rst) begin
            rr_state <= 2'd0;
            rr_idx   <= 7'd0;
        end else begin
            case (rr_state)
                2'd0: if (go_deliver) rr_state <= 2'd1;
                2'd1: if (!done)      rr_state <= 2'd2;   // run underway
                2'd2: if (done) begin rr_state <= 2'd3; rr_idx <= 7'd0; end
                2'd3: if (rr_accept) begin
                    if (rr_idx == N*N-1) rr_state <= 2'd0;
                    else                 rr_idx   <= rr_idx + 7'd1;
                end
            endcase
        end
    end

    // ---- Tile ----
    wire       start_eff = start | go_pulse;
    wire [3:0] k_eff     = go_pulse ? go_k : k_chunks;

    gemm_tile #(.N(N), .KMAX(KMAX), .PE_ACC_LATENCY(PE_ACC_LATENCY)) tile_i (
        .clk      (clk),
        .rst      (rst),
        .wr_en    (wr_en),
        .wr_addr  (wr_addr),
        .wr_a_col (wr_a_col),
        .wr_b_row (wr_b_row),
        .start    (start_eff),
        .k_chunks (k_eff),
        .busy     (busy),
        .done     (done),
        .acc_out  (acc_out)
    );

endmodule
