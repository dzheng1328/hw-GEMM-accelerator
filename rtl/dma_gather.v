`timescale 1ns / 1ps

// rtl/dma_gather.v -- the command processor's DMA (milestone 4.2,
// docs/specs/2026-09-25-command-processor-cifar10-design.md section 2).
// For one BLOCK it streams the round's K slots as OPERAND beats
// {slot, A column, B row} -- A straight from weight word
// W_BASE + group*KS + k, B the 8-lane im2col gather of the spec's "Gather
// semantics" -- then one GO beat carrying k_chunks. rtl/flit_pack.v turns
// beats into flits. compiler/golden.py (Golden.operands) is the reference.
//
// Every BLOCK field and register input is held stable by the caller from
// start until handoff, the cycle S0 emits the BLOCK's last OPERAND beat.
// The DMA latches its counters, k_chunks, and the caller's opaque tag
// (rtl/flit_pack.v's BLOCK fields) at start, and carries every per-beat
// value (stride2, bias_val, k_chunks, tag) down the pipeline, so the next
// BLOCK starts while this one drains: with no backpressure its first slot
// follows this BLOCK's GO beat with no gap. ready accepts a start whenever
// S0 is free, including the cycle S0 emits the previous GO beat.
//
// Pipeline, one slot per cycle, one global stall (adv):
//   S0  slot counters (local slot j, channel c, tap ky/kx); combinational
//       weight address, the slot's three consecutive activation words
//       (a stride-2 window spans up to three), and the row/lane/bias masks.
//       The four banks (word w in bank w mod 4) each read one of the three.
//   S1  memory data; rotate the banks into a 24-byte window, shift by the
//       byte offset, take lanes at stride 1 or 2, apply the masks.
//   S2  output register.
// Memories read synchronously and hold their data while re (= adv) is low.
//
// Memory-port contract (4.3f's shared ports rely on it): act_re and wt_re
// equal adv every cycle, idle or not, and the read addresses are S0's
// combinational ones. handoff releases the BLOCK's inputs, not the memory
// ports: the last slot's read data is still in the memories' output
// registers, and S1 needs it held until that slot advances out of S1.
module dma_gather #(
    parameter ACT_BW = 15,             // activation bank address bits
    parameter WT_AW  = 15,             // weight memory address bits
    parameter TAGW   = 1                // opaque per-BLOCK tag bits
) (
    input  wire                clk,
    input  wire                rst,
    // One BLOCK; held stable from start until handoff.
    input  wire                start,
    input  wire [5:0]          group,
    input  wire [7:0]          pixel_block,
    input  wire [6:0]          round,
    input  wire [2:0]          ky0,
    input  wire [2:0]          kx0,
    // Layer registers (spec register map), narrowed to the bits used.
    input  wire [ACT_BW+4:0]   in_base,     // byte address
    input  wire [WT_AW-1:0]    w_base,
    input  wire [3:0]          cin_log2,
    input  wire [3:0]          h_log2,
    input  wire [3:0]          w_log2,
    input  wire [3:0]          wout_log2,
    input  wire                stride2,     // STRIDE == 2
    input  wire                pad,
    input  wire [3:0]          ksize,
    input  wire [15:0]         ks,
    input  wire [15:0]         bias_start,
    input  wire [7:0]          bias_val,
    output wire                busy,
    output wire                ready,       // start is accepted this cycle
    output wire                handoff,     // inputs may change from the next cycle
    input  wire [TAGW-1:0]     tag,         // returned with every beat of this BLOCK
    // Memory read ports.
    output wire                act_re,
    output wire [4*ACT_BW-1:0] act_raddr,   // bank b at [b*ACT_BW +: ACT_BW]
    input  wire [4*64-1:0]     act_rdata,
    output wire                wt_re,
    output wire [WT_AW-1:0]    wt_raddr,
    input  wire [63:0]         wt_rdata,
    // Beats: OPERAND beats {slot, a, b}, then one GO beat {kchunks}.
    output reg                 out_valid,
    input  wire                out_ready,
    output reg                 out_go,
    output reg  [5:0]          out_slot,
    output reg  [63:0]         out_a,
    output reg  [63:0]         out_b,
    output reg  [3:0]          out_kchunks,
    output reg  [TAGW-1:0]     out_tag
);

    localparam WA = ACT_BW + 2;        // activation word address bits
    localparam BA = WA + 3;            // activation byte address bits

    wire adv = !out_valid || out_ready;

    // ---------------- S0: slot counters ----------------
    reg        active, go_pend;
    reg [6:0]  j;
    reg [14:0] c;
    reg [2:0]  ky, kx;
    reg        v1, go1;

    wire [15:0] k0        = {3'b000, round, 6'b000000};
    wire [15:0] rem       = ks - k0;
    wire [6:0]  n_slots   = (rem >= 16'd64) ? 7'd64 : rem[6:0];
    wire [15:0] k         = k0 + {9'd0, j};
    wire [14:0] cmask     = (15'd1 << cin_log2) - 15'd1;
    wire        emit_slot = active && adv;
    wire        emit_go   = go_pend && adv;

    reg [3:0]      kchunks0;
    reg [TAGW-1:0] tag0;
    wire           last_slot = emit_slot && (j == n_slots - 7'd1);

    assign busy    = active || go_pend || v1 || out_valid;
    assign ready   = !active && (!go_pend || adv);
    assign handoff = last_slot;

    always @(posedge clk) begin
        if (rst) begin
            active  <= 1'b0;
            go_pend <= 1'b0;
        end else if (start && ready) begin
            // A GO beat still pending is emitted this cycle (with go_pend,
            // ready implies adv), and S1 samples the old kchunks0/tag0 at
            // this same edge.
            active   <= 1'b1;
            go_pend  <= 1'b0;
            j        <= 7'd0;
            c        <= k0[14:0] & cmask;
            ky       <= ky0;
            kx       <= kx0;
            kchunks0 <= n_slots[6:3];
            tag0     <= tag;
        end else if (emit_slot) begin
            j <= j + 7'd1;
            if (c == cmask) begin
                c <= 15'd0;
                if ({1'b0, kx} == ksize - 4'd1) begin
                    kx <= 3'd0;
                    ky <= ky + 3'd1;
                end else begin
                    kx <= kx + 3'd1;
                end
            end else begin
                c <= c + 15'd1;
            end
            if (last_slot) begin
                active  <= 1'b0;
                go_pend <= 1'b1;
            end
        end else if (emit_go) begin
            go_pend <= 1'b0;
        end
    end

    // Slot geometry. Values that can go negative are 16-bit two's complement
    // (bit 15 = negative; every real value is far below 2**15).
    wire [10:0] p0        = {pixel_block, 3'b000};
    wire [10:0] oy        = p0 >> wout_log2;
    wire [10:0] ox0       = p0 & ((11'd1 << wout_log2) - 11'd1);
    wire [15:0] iy        = ({5'd0, oy} << stride2) + {13'd0, ky} - {15'd0, pad};
    wire [15:0] ix0       = ({5'd0, ox0} << stride2) + {13'd0, kx} - {15'd0, pad};
    wire [15:0] hdim      = 16'd1 << h_log2;
    wire [15:0] wdim      = 16'd1 << w_log2;
    wire        row_ok    = !iy[15] && (iy < hdim);
    wire        is_tap    = (k < bias_start);
    wire        all_lanes = (wout_log2 != 4'd0);   // Wout = 1: lane 0 only

    reg [7:0]  data_mask, bias_mask;
    reg [15:0] ixl;
    integer    l;
    always @(*) begin
        for (l = 0; l < 8; l = l + 1) begin
            ixl = ix0 + ({13'd0, l[2:0]} << stride2);
            data_mask[l] = is_tap && row_ok && (all_lanes || l == 0) && !ixl[15] && (ixl < wdim);
            bias_mask[l] = !is_tap && (all_lanes || l == 0);
        end
    end

    // Byte address of the slot's first lane (ix0 may be -1: one byte before
    // the row, a masked lane) and the three words from its word on.
    wire [BA-1:0] plane  = {{(BA-15){1'b0}}, c} << ({1'b0, h_log2} + {1'b0, w_log2});
    wire [BA-1:0] rowoff = {{(BA-16){iy[15]}}, iy} << w_log2;
    wire [BA-1:0] byte0  = in_base + plane + rowoff + {{(BA-16){ix0[15]}}, ix0};
    wire [WA-1:0] wb     = byte0[BA-1:3];

    // Bank b holds word wb + ((b - wb) mod 4), at bank address
    // (wb >> 2) + carry[b], carry[b] = (b < wb mod 4).
    wire [3:0] carry = (4'd1 << wb[1:0]) - 4'd1;
    genvar b;
    generate
        for (b = 0; b < 4; b = b + 1) begin : bank_addr
            assign act_raddr[b*ACT_BW +: ACT_BW] = wb[WA-1:2] + {{(ACT_BW-1){1'b0}}, carry[b]};
        end
    endgenerate

    assign act_re   = adv;
    assign wt_re    = adv;
    assign wt_raddr = w_base + {{(WT_AW-6){1'b0}}, group} * ks[WT_AW-1:0] + k[WT_AW-1:0];

    // ---------------- S1: window select ----------------
    reg [5:0] slot1;
    reg [7:0] dmask1, bmask1;
    reg [2:0] o1;
    reg [1:0] wlo1;
    reg       stride2_1;
    reg [7:0] bias_val1;
    reg [3:0] kchunks1;
    reg [TAGW-1:0] tag1;

    always @(posedge clk) begin
        if (rst) begin
            v1 <= 1'b0;
        end else if (adv) begin
            v1        <= emit_slot || emit_go;
            go1       <= emit_go;
            slot1     <= j[5:0];
            dmask1    <= data_mask;
            bmask1    <= bias_mask;
            o1        <= byte0[2:0];
            wlo1      <= wb[1:0];
            stride2_1 <= stride2;
            bias_val1 <= bias_val;
            kchunks1  <= kchunks0;
            tag1      <= tag0;
        end
    end

    reg [1:0]   bsel;
    reg [191:0] window;
    reg [191:0] shifted;
    reg [7:0]   byte_l;
    reg [63:0]  b_row;
    integer     i;
    always @(*) begin
        for (i = 0; i < 3; i = i + 1) begin
            bsel = wlo1 + i[1:0];
            window[64*i +: 64] = act_rdata[{bsel, 6'b000000} +: 64];
        end
        shifted = window >> {o1, 3'b000};
        for (i = 0; i < 8; i = i + 1) begin
            byte_l = stride2_1 ? shifted[16*i +: 8] : shifted[8*i +: 8];
            b_row[8*i +: 8] = dmask1[i] ? byte_l : (bmask1[i] ? bias_val1 : 8'd0);
        end
    end

    // ---------------- S2: output ----------------
    always @(posedge clk) begin
        if (rst) begin
            out_valid <= 1'b0;
        end else if (adv) begin
            out_valid   <= v1;
            out_go      <= go1;
            out_slot    <= slot1;
            out_a       <= wt_rdata;
            out_b       <= b_row;
            out_kchunks <= kchunks1;
            out_tag     <= tag1;
        end
    end

endmodule
