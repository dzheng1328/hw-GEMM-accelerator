`timescale 1ns / 1ps

// rtl/flit_buf.v -- a 2-entry registered flit FIFO (skid buffer), one per
// router input on each mesh link. This is the piece rtl/router.v's header
// says the mesh step must add: the router itself is a combinational
// single-cycle crossbar, so wiring routers' out ports straight to neighbours'
// in ports would create combinational cycles (ready chasing valid around the
// mesh). This buffer breaks both directions with registers:
//
//   * out_valid / out_flit come from register state (the stored entries), so
//     a downstream router never sees a combinational path from its own
//     signals back into its inputs.
//   * in_ready = (count < 2) depends only on the registered occupancy count,
//     never on the downstream out_ready -- so upstream backpressure is also
//     register-clean.
//
// Two entries (not one) so the link sustains full throughput: with a 1-deep
// register, in_ready would have to drop every other cycle (or depend
// combinationally on out_ready, defeating the point). Flits are delivered
// strictly in order.
module flit_buf #(
    parameter FW = 138   // flit width, must match the routers on both ends
) (
    input  wire          clk,
    input  wire          rst,      // sync, active-high; empties the buffer
    input  wire          in_valid,
    input  wire [FW-1:0] in_flit,
    output wire          in_ready,
    output wire          out_valid,
    output wire [FW-1:0] out_flit,
    input  wire          out_ready
);

    reg [FW-1:0] mem [0:1];
    reg          wr_ptr, rd_ptr;
    reg [1:0]    count;

    assign in_ready  = (count < 2'd2);
    assign out_valid = (count != 2'd0);
    assign out_flit  = mem[rd_ptr];

    wire push = in_valid && in_ready;
    wire pop  = out_valid && out_ready;

    always @(posedge clk) begin
        if (rst) begin
            wr_ptr <= 1'b0;
            rd_ptr <= 1'b0;
            count  <= 2'd0;
        end else begin
            if (push) begin
                mem[wr_ptr] <= in_flit;
                wr_ptr      <= ~wr_ptr;
            end
            if (pop) begin
                rd_ptr <= ~rd_ptr;
            end
            count <= count + push - pop;
        end
    end

endmodule
