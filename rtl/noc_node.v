`timescale 1ns / 1ps

// rtl/noc_node.v -- one mesh node: a router (rtl/router.v) attached to a full
// self-sequencing GEMM tile (rtl/gemm_tile.v), with registered flit buffers
// (rtl/flit_buf.v) on every mesh-side router input to break the combinational
// cycles a raw crossbar mesh would form.
//
// The router's LOCAL output port is wired straight into the tile's
// operand_mem write port: a flit whose destination is this node's (my_x,my_y)
// gets its payload delivered as an addressed operand write. The payload IS
// the write -- {wr_addr, wr_a_col, wr_b_row} -- which is exactly the
// interface operand_mem exposed for this purpose (docs/decisions.md,
// 2026-07-19 operand-memory entry). The memory accepts a write every cycle,
// so the LOCAL out_ready is tied high (a delivered flit is never stalled).
//
// The LOCAL *input* port is this node's injection point (a source of new
// packets: a testbench today, a DMA/host later). It goes to the router
// unbuffered -- the injector obeys the valid/ready handshake directly.
//
// Still direct wires, deliberately not packetized in this increment (see
// docs/decisions.md): compute kickoff (start/k_chunks), status (busy/done),
// and result readout (acc_out). GO-command flits and result-return flits are
// a later step; this node proves operand *delivery* over the network.
module noc_node #(
    parameter N    = 8,
    parameter KMAX = 8,
    parameter AW   = 2,
    // Derived -- do not override.
    parameter ADDRW = 6,               // $clog2(N*KMAX) for the defaults
    parameter PW    = ADDRW + 16*N,    // {wr_addr, wr_a_col, wr_b_row} = 134
    parameter FW    = PW + 2*AW        // 138
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

    // Tile control/status/result -- direct, not packetized (this increment).
    input  wire            start,
    input  wire [3:0]      k_chunks,
    output wire            busy,
    output wire            done,
    output wire signed [32*N*N-1:0] acc_out
);

    localparam LOCAL = 0, NORTH = 1, EAST = 2, SOUTH = 3, WEST = 4;
    localparam NP = 5;

    // ---- Input buffers on the four mesh ports ----
    wire [3:0]      buf_valid;   // {W,S,E,N} post-buffer valid
    wire [FW-1:0]   buf_flit  [0:3];
    wire [3:0]      buf_ready;   // router-side ready back into each buffer

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

    // ---- Router ----
    wire [NP-1:0]    r_in_valid, r_in_ready, r_out_valid, r_out_ready;
    wire [NP*FW-1:0] r_in_flit, r_out_flit;

    assign r_in_valid[LOCAL] = lcl_in_valid;
    assign r_in_valid[NORTH] = buf_valid[0];
    assign r_in_valid[EAST]  = buf_valid[1];
    assign r_in_valid[SOUTH] = buf_valid[2];
    assign r_in_valid[WEST]  = buf_valid[3];

    assign r_in_flit[LOCAL*FW +: FW] = lcl_in_flit;
    assign r_in_flit[NORTH*FW +: FW] = buf_flit[0];
    assign r_in_flit[EAST*FW  +: FW] = buf_flit[1];
    assign r_in_flit[SOUTH*FW +: FW] = buf_flit[2];
    assign r_in_flit[WEST*FW  +: FW] = buf_flit[3];

    assign lcl_in_ready = r_in_ready[LOCAL];
    assign buf_ready[0] = r_in_ready[NORTH];
    assign buf_ready[1] = r_in_ready[EAST];
    assign buf_ready[2] = r_in_ready[SOUTH];
    assign buf_ready[3] = r_in_ready[WEST];

    router #(.AW(AW), .PW(PW)) rt (
        .clk(clk), .rst(rst),
        .my_x(my_x), .my_y(my_y),
        .in_valid(r_in_valid), .in_flit(r_in_flit), .in_ready(r_in_ready),
        .out_valid(r_out_valid), .out_flit(r_out_flit), .out_ready(r_out_ready)
    );

    // Mesh-side outputs come straight off the router; the neighbour's input
    // buffer is the registering element on each link.
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

    // ---- LOCAL delivery: flit payload -> operand_mem write ----
    wire [FW-1:0] lflit   = r_out_flit[LOCAL*FW +: FW];
    wire [PW-1:0] payload = lflit[FW-1 : 2*AW];   // strip {dest_y, dest_x}

    wire                 wr_en    = r_out_valid[LOCAL];
    wire [8*N-1:0]       wr_b_row = payload[8*N-1 : 0];
    wire [8*N-1:0]       wr_a_col = payload[16*N-1 : 8*N];
    wire [ADDRW-1:0]     wr_addr  = payload[PW-1 : 16*N];
    assign r_out_ready[LOCAL] = 1'b1;   // the memory accepts a write every cycle

    gemm_tile #(.N(N), .KMAX(KMAX)) tile_i (
        .clk      (clk),
        .rst      (rst),
        .wr_en    (wr_en),
        .wr_addr  (wr_addr),
        .wr_a_col (wr_a_col),
        .wr_b_row (wr_b_row),
        .start    (start),
        .k_chunks (k_chunks),
        .busy     (busy),
        .done     (done),
        .acc_out  (acc_out)
    );

endmodule
