`timescale 1ns / 1ps

// rtl/node_perf.v -- per-node performance counters (issue #54). 14 free-running
// 32-bit counters, cleared only by reset. Software measures a region by
// snapshotting them before and after and subtracting modulo 2^32, so there is
// no clear/enable logic. Read by hierarchy from cocotb today; an on-chip
// readout path is 4.2's command processor's job.
//
// Router port index (matches rtl/noc_node.v): 0 LOCAL, 1 NORTH, 2 EAST,
// 3 SOUTH, 4 WEST. A mesh link's occupancy is its sender's out_xfer_*/
// out_stall_* for that direction.
module node_perf (
    input  wire       clk,
    input  wire       rst,
    input  wire       busy,          // tile running a GEMM
    input  wire       feeding,       // real operand data entering the array (64 MACs)
    input  wire [4:0] out_valid,     // router output ports
    input  wire [4:0] out_ready,
    input  wire       lcl_in_valid,  // router LOCAL input (host injection + result stream)
    input  wire       lcl_in_ready
);

    wire [4:0] out_xfer  = out_valid &  out_ready;
    wire [4:0] out_stall = out_valid & ~out_ready;

    reg [31:0] busy_cyc, feed_cyc;
    reg [31:0] out_xfer_l,  out_xfer_n,  out_xfer_e,  out_xfer_s,  out_xfer_w;
    reg [31:0] out_stall_l, out_stall_n, out_stall_e, out_stall_s, out_stall_w;
    reg [31:0] lcl_in_xfer, lcl_in_stall;

    always @(posedge clk) begin
        if (rst) begin
            busy_cyc     <= 32'd0;
            feed_cyc     <= 32'd0;
            out_xfer_l   <= 32'd0;
            out_xfer_n   <= 32'd0;
            out_xfer_e   <= 32'd0;
            out_xfer_s   <= 32'd0;
            out_xfer_w   <= 32'd0;
            out_stall_l  <= 32'd0;
            out_stall_n  <= 32'd0;
            out_stall_e  <= 32'd0;
            out_stall_s  <= 32'd0;
            out_stall_w  <= 32'd0;
            lcl_in_xfer  <= 32'd0;
            lcl_in_stall <= 32'd0;
        end else begin
            busy_cyc     <= busy_cyc     + {31'd0, busy};
            feed_cyc     <= feed_cyc     + {31'd0, feeding};
            out_xfer_l   <= out_xfer_l   + {31'd0, out_xfer[0]};
            out_xfer_n   <= out_xfer_n   + {31'd0, out_xfer[1]};
            out_xfer_e   <= out_xfer_e   + {31'd0, out_xfer[2]};
            out_xfer_s   <= out_xfer_s   + {31'd0, out_xfer[3]};
            out_xfer_w   <= out_xfer_w   + {31'd0, out_xfer[4]};
            out_stall_l  <= out_stall_l  + {31'd0, out_stall[0]};
            out_stall_n  <= out_stall_n  + {31'd0, out_stall[1]};
            out_stall_e  <= out_stall_e  + {31'd0, out_stall[2]};
            out_stall_s  <= out_stall_s  + {31'd0, out_stall[3]};
            out_stall_w  <= out_stall_w  + {31'd0, out_stall[4]};
            lcl_in_xfer  <= lcl_in_xfer  + {31'd0, lcl_in_valid &  lcl_in_ready};
            lcl_in_stall <= lcl_in_stall + {31'd0, lcl_in_valid & ~lcl_in_ready};
        end
    end

endmodule
