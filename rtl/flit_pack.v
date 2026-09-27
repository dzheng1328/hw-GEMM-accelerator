`timescale 1ns / 1ps

// rtl/flit_pack.v -- the command processor's flit formatter (milestone 4.2,
// docs/specs/2026-09-25-command-processor-cifar10-design.md section 3).
// Turns rtl/dma_gather.v's beats into flits for node (0,0)'s injection port:
// an OPERAND beat {slot, a, b} becomes an OPERAND flit to the BLOCK's tile,
// and the GO beat a GO flit with the BLOCK's flags and requant (m, sh), the
// round's k_chunks, and return address (0, 0) (flit layout: rtl/noc_node.v).
// Flits are formatted before rtl/flit_buf.v's skid buffer, so the BLOCK
// fields need only hold until the GO beat is accepted, and in_ready depends
// only on the skid's registered occupancy.
module flit_pack #(
    parameter AW    = 2,               // mesh coordinate width
    parameter ADDRW = 6,               // operand slot address bits
    parameter N     = 8,               // lanes
    // Derived -- do not override.
    parameter PW    = ADDRW + 16*N,
    parameter TW    = 2,
    parameter FW    = TW + PW + 2*AW
) (
    input  wire             clk,
    input  wire             rst,
    // BLOCK fields, stable until the GO beat is accepted.
    input  wire [AW-1:0]    dest_x,
    input  wire [AW-1:0]    dest_y,
    input  wire             acc_keep,
    input  wire             no_ret,
    input  wire             requant,
    input  wire             relu,
    input  wire [5:0]       sh,
    input  wire [15:0]      m,
    // Beats from rtl/dma_gather.v.
    input  wire             in_valid,
    output wire             in_ready,
    input  wire             in_go,
    input  wire [ADDRW-1:0] in_slot,
    input  wire [8*N-1:0]   in_a,
    input  wire [8*N-1:0]   in_b,
    input  wire [3:0]       in_kchunks,
    // Node (0,0)'s injection port.
    output wire             inj_valid,
    output wire [FW-1:0]    inj_flit,
    input  wire             inj_ready
);

    localparam [1:0] T_OPR = 2'd0, T_GO = 2'd1;

    initial begin
        if (PW < 42 || 4 + 2*AW > 16)
            $fatal(1, "flit_pack: PW=%0d / AW=%0d do not fit the GO descriptor", PW, AW);
    end

    // GO descriptor (rtl/noc_node.v): [3:0] k_chunks, [4 +: AW] ret_x and
    // [4+AW +: AW] ret_y (both 0: results return to the command processor at
    // (0,0)), [31:16] m, [37:32] sh, [38] relu, [39] rq_en, [40] acc_keep,
    // [41] no_ret.
    wire [PW-1:0] opr_payload = {in_slot, in_a, in_b};
    wire [PW-1:0] go_payload  = {{(PW-42){1'b0}}, no_ret, acc_keep, requant, relu, sh, m,
                                 {(12-2*AW){1'b0}}, {(2*AW){1'b0}}, in_kchunks};
    wire [FW-1:0] flit = {in_go ? T_GO : T_OPR, in_go ? go_payload : opr_payload, dest_y, dest_x};

    flit_buf #(.FW(FW)) skid (
        .clk(clk), .rst(rst),
        .in_valid(in_valid), .in_flit(flit), .in_ready(in_ready),
        .out_valid(inj_valid), .out_flit(inj_flit), .out_ready(inj_ready)
    );

endmodule
