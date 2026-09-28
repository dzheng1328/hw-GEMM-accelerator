`timescale 1ns / 1ps

// rtl/writeback.v -- the command processor's result write-back (milestone
// 4.2, docs/specs/2026-09-25-command-processor-cifar10-design.md section 2).
// Every returning BLOCK pushes one entry {raw, base, step} (computed by
// rtl/cmd_seq.v) onto its tile's 2-deep FIFO; the tile's RESULT flits,
// delivered at node (0,0), then land in activation memory at
//   RESULT8 row i:        base + i * step
//   RESULT cell i*8 + j:  base + i * step + j
// and the block's last flit (row 7, or cell 63) pops the entry. A tile
// returns its blocks in order, so its oldest entry always matches.
// compiler/golden.py (Golden.result_words) is the reference.
//
// The delivered flit is registered first (stage R), so the FIFO lookup and
// the address arithmetic sit between that register and the memory's write
// port, not behind the router's crossbar. idle (no entry anywhere) is what
// WAIT and END wait on; full[t] stalls cmd_seq's next returning BLOCK to
// tile t. RESULT flits are never backpressured: at most one arrives per
// cycle, and one word is written per cycle.
module writeback #(
    parameter W      = 2,
    parameter H      = 2,
    parameter AW     = 2,
    parameter ACT_BW = 15,
    // Derived -- do not override.
    parameter NN     = W * H,
    parameter TIW    = (NN > 1) ? $clog2(NN) : 1,   // tile index bits
    parameter WA     = ACT_BW + 2                   // activation word address bits
) (
    input  wire                clk,
    input  wire                rst,
    // Entries from rtl/cmd_seq.v, one per returning BLOCK.
    input  wire                push,
    input  wire [TIW-1:0]      push_tile,
    input  wire                push_raw,
    input  wire [WA-1:0]       push_base,
    input  wire [11:0]         push_step,
    output wire [(1<<TIW)-1:0] full,
    output wire                idle,
    // RESULT / RESULT8 flits delivered at node (0,0) (rtl/noc_mesh.v res_*).
    input  wire                res_valid,
    input  wire                res_q8,
    input  wire [AW-1:0]       res_src_x,
    input  wire [AW-1:0]       res_src_y,
    input  wire [5:0]          res_idx,
    input  wire [63:0]         res_data,
    // Activation memory write (word address; rtl/accel.v picks the bank).
    output wire                act_we,
    output wire [WA-1:0]       act_waddr,
    output wire [63:0]         act_wdata
);

    localparam NT = 1 << TIW;          // tile slots; slots >= NN never get entries
    localparam EW = 1 + WA + 12;       // entry: {raw, base, step}
    localparam [31:0] W32 = W;

    // Two entries per tile, at {tile, pointer}.
    reg [EW-1:0]  ent [0:2*NT-1];
    reg [NT-1:0]  wp, rp;
    reg [1:0]     cnt [0:NT-1];
    reg [TIW+1:0] outstanding;         // entries anywhere, at most 2*NT

    // ---- Stage R: the delivered flit ----
    wire [31:0] src_lin = {{(32-AW){1'b0}}, res_src_y} * W32 + {{(32-AW){1'b0}}, res_src_x};
    wire        unused_src_lin = &{1'b0, src_lin};
    reg            r_valid, r_q8;
    reg  [TIW-1:0] r_tile;
    reg  [5:0]     r_idx;
    reg  [63:0]    r_data;

    // ---- Stage W: the tile's oldest entry gives the address ----
    wire [EW-1:0] head   = ent[{r_tile, rp[r_tile]}];
    wire          h_raw  = head[EW-1];
    wire [WA-1:0] h_base = head[12 +: WA];
    wire [11:0]   h_step = head[11:0];
    wire [2:0]    row    = r_q8 ? r_idx[2:0] : r_idx[5:3];
    wire [2:0]    col    = r_q8 ? 3'd0 : r_idx[2:0];
    wire          pop    = r_valid && (r_q8 ? (r_idx == 6'd7) : (r_idx == 6'd63));

    assign act_we    = r_valid;
    assign act_waddr = h_base + {{(WA-12){1'b0}}, h_step} * {{(WA-3){1'b0}}, row}
                     + {{(WA-3){1'b0}}, col};
    assign act_wdata = r_data;
    assign idle      = (outstanding == {(TIW+2){1'b0}});

    genvar t;
    generate
        for (t = 0; t < NT; t = t + 1) begin : g_full
            assign full[t] = cnt[t][1];
        end
    endgenerate

    integer i;
    always @(posedge clk) begin
        if (rst) begin
            r_valid     <= 1'b0;
            wp          <= {NT{1'b0}};
            rp          <= {NT{1'b0}};
            outstanding <= {(TIW+2){1'b0}};
            for (i = 0; i < NT; i = i + 1)
                cnt[i] <= 2'd0;
        end else begin
            r_valid <= res_valid;
            r_q8    <= res_q8;
            r_tile  <= src_lin[TIW-1:0];
            r_idx   <= res_idx;
            r_data  <= res_data;
            if (push) begin
                ent[{push_tile, wp[push_tile]}] <= {push_raw, push_base, push_step};
                wp[push_tile] <= ~wp[push_tile];
            end
            if (pop)
                rp[r_tile] <= ~rp[r_tile];
            for (i = 0; i < NT; i = i + 1)
                cnt[i] <= cnt[i] + {1'b0, push && push_tile == i[TIW-1:0]}
                                 - {1'b0, pop && r_tile == i[TIW-1:0]};
            outstanding <= outstanding + {{(TIW+1){1'b0}}, push} - {{(TIW+1){1'b0}}, pop};
        end
    end

`ifndef SYNTHESIS
    // A RESULT whose tile has no pending entry, or of the other kind than
    // the entry, is a block nobody asked for: a bug in cmd_seq or the mesh,
    // never a program error.
    always @(posedge clk)
        if (!rst && r_valid && (cnt[r_tile] == 2'd0 || h_raw == r_q8))
            $fatal(1, "writeback: a RESULT flit (q8=%0d) from tile %0d matches no pending block", r_q8, r_tile);
`endif

endmodule
