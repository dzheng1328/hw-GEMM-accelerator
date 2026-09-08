`timescale 1ns / 1ps

// rtl/operand_mem.v -- the tile's operand buffer, backed by a real sky130 SRAM
// macro (issue #31/#32). One slot == one (chunk, column) of a tiled matmul: it
// holds an unskewed column of A (rd_a_col) and the matching row of B
// (rd_b_row). Addressing is addr = chunk*N + col, so an N-chunk N-block
// occupies N*chunks slots (up to N*KMAX).
//
// The write port is deliberately shaped like what a NoC/DMA delivers:
// {wr_addr, wr_a_col, wr_b_row} is an addressed operand payload.
//
// The real macro has one shared address/control port per bank, not separate
// read and write ports -- write wins by priority (wr_en ? wr_addr : rd_addr)
// since no real caller today ever asserts wr_en and expects a read in the same
// cycle (write happens during the NoC load phase; reads happen once the
// sequencer starts the compute phase).
//
// Read is now REGISTERED (RD_LATENCY cycles after rd_addr is presented, not
// the same cycle) -- a real SRAM macro's read is synchronous. Issue #33 threads
// RD_LATENCY into gemm_sequencer.v's drain-window sizing.
//
// The real macro's port is wider than this module's own 6-bit/64-bit logical
// interface (issue #48): openram/config_operand_bank.py's num_spare_rows=1/
// num_spare_cols=1 workaround (required to satisfy sky130's row/column parity
// constraint for this exact 64-word/64-bit/words_per_row=2 geometry) grows the
// real generated macro's port to ADDR_WIDTH=7 (MACRO_ADDR_WIDTH below) and
// DATA_WIDTH=65 (MACRO_DATA_WIDTH below), plus an extra spare_wen0 mask pin --
// confirmed against OpenRAM's own generated sky130_sram_512b_1rw_64x64.v and
// its compiler/base/verilog.py template (pinned commit b2b069ce..., same as
// issue #31/#32 used). Traced the exact address layout via that template
// (bank.py: row-select bits sit at addr[col_addr_size +: row_addr_size],
// col-select is addr[0] for words_per_row=2 -> col_addr_size=1): with
// num_words_per_bank=64 and words_per_row=2, the 64 real logical words land
// at flat addresses 0..63 in row-major order, contiguously and unpermuted, so
// this module's existing 6-bit address zero-extends straight into the real
// macro's low 6 address bits with no remapping -- MACRO_ADDR_WIDTH's extra
// bit only ever selects the spare row (address 64+), which this module never
// addresses. spare_wen0 is active-high (verified against the same template's
// add_write_block: the spare column is only written when spare_wen{port} is
// asserted during a real write), so tying it low keeps the spare column
// untouched regardless of what's tied to its data bit.
module operand_mem #(
    parameter N    = 8,
    parameter KMAX = 8
) (
    input  wire                            clk,
    // Load / write port (NoC/DMA delivers this).
    input  wire                            wr_en,
    input  wire [$clog2(N*KMAX)-1:0]       wr_addr,
    input  wire signed [8*N-1:0]           wr_a_col,   // unskewed column of A for this slot
    input  wire signed [8*N-1:0]           wr_b_row,   // matching row of B for this slot
    // Read port (to the sequencer / tile), registered.
    input  wire [$clog2(N*KMAX)-1:0]       rd_addr,
    output wire signed [8*N-1:0]           rd_a_col,
    output wire signed [8*N-1:0]           rd_b_row
);

    localparam RD_LATENCY = 1;  // real SRAM macro: registered (synchronous) read

    // sky130_sram_512b_1rw_64x64's real port shape -- see the module header
    // comment above for the derivation. Only valid for this exact macro
    // config; would need re-deriving from a fresh OpenRAM run if N/KMAX ever
    // changed (the macro name itself is already hardcoded to this config).
    localparam MACRO_ADDR_WIDTH = 7;
    localparam MACRO_DATA_WIDTH = 65;

    wire [$clog2(N*KMAX)-1:0] a_addr = wr_en ? wr_addr : rd_addr;
    wire [$clog2(N*KMAX)-1:0] b_addr = wr_en ? wr_addr : rd_addr;

    wire [MACRO_DATA_WIDTH-1:0] a_dout_raw, b_dout_raw;
    assign rd_a_col = a_dout_raw[8*N-1:0];
    assign rd_b_row = b_dout_raw[8*N-1:0];

    sky130_sram_512b_1rw_64x64 a_bank (
        .clk0       (clk),
        .csb0       (1'b0),
        .web0       (~wr_en),
        .spare_wen0 (1'b0),
        .addr0      ({{(MACRO_ADDR_WIDTH-$clog2(N*KMAX)){1'b0}}, a_addr}),
        .din0       ({1'b0, wr_a_col}),
        .dout0      (a_dout_raw)
    );

    sky130_sram_512b_1rw_64x64 b_bank (
        .clk0       (clk),
        .csb0       (1'b0),
        .web0       (~wr_en),
        .spare_wen0 (1'b0),
        .addr0      ({{(MACRO_ADDR_WIDTH-$clog2(N*KMAX)){1'b0}}, b_addr}),
        .din0       ({1'b0, wr_b_row}),
        .dout0      (b_dout_raw)
    );

endmodule
