`timescale 1ns / 1ps

// rtl/vpu_silu.v -- the vector unit's SILU_MUL (milestone 4.3e): SwiGLU's
// gate (model/fixedpoint.py silu_mul_q; compiler/golden_vop.py silu_mul):
//
//   ra = gate (int8 feature words, 192; the up projection follows at ra + 192)
//   rb = destination (int8 feature words, 192: byte s is story s)
//   rc = the layer's SiLU block (A word): a parameter word (m [15:0],
//        sh [21:16]) then the 256-entry int16 table in 64 words, entry g + 128
//        for gate value g
//
//   y = requant(table[g] * u)
//
// The parameter word and the 64 table words are read first (the table is held
// in a 256 x 16 register array). Then each output word reads its gate word
// and its up word, and the 8 lanes look up their 8 table entries and round
// table * u.
module vpu_silu (
    input  wire        clk,
    input  wire        rst,
    input  wire        kill,
    input  wire        go,
    input  wire [16:0] ra,
    input  wire [16:0] rb,
    input  wire [15:0] rc,
    output reg         ar_v,
    output reg  [16:0] ar_a,
    output reg         br_v,
    output reg  [15:0] br_a,
    output reg  [15:0] rq_i,
    input  wire        dv,
    input  wire [15:0] di,
    input  wire [63:0] dw,
    output reg         aw_v,
    output reg  [16:0] aw_a,
    output reg  [63:0] aw_d,
    output reg         fin
);

    localparam [15:0] K_PARAM = 16'd0, K_TAB = 16'd1, K_GATE = 16'd2, K_UP = 16'd3;

    reg         act;
    reg  [8:0]  ic;          // reads issued, 0 .. 448
    reg  [15:0] m;
    reg  [5:0]  sh;
    reg  [15:0] tab [0:255];
    reg  [5:0]  tw;          // table words arrived
    reg  [7:0]  cf;          // output words written
    reg  [63:0] gate;

    // Lane s looks up the entry of its gate byte (g + 128 is g with the sign bit flipped).
    wire [255:0] accs;
    wire [127:0] ms;
    wire [47:0]  shs;
    wire [63:0]  q;
    genvar l;
    generate
        for (l = 0; l < 8; l = l + 1) begin : g_lane
            wire signed [15:0] ent = tab[{~gate[8*l + 7], gate[8*l +: 7]}];
            wire signed [7:0]  u   = dw[8*l +: 8];
            assign accs[32*l +: 32] = ent * u;
            assign ms[16*l +: 16]   = m;
            assign shs[6*l +: 6]    = sh;
        end
    endgenerate
    vpu_lanes #(.LANES(8), .QW(8)) lanes (.acc(accs), .m(ms), .sh(shs), .q(q));

    // Reads 65 on are gate/up pairs: j = ic - 65 is even for the gate word,
    // which is word j / 2; the up word is 192 words further.
    wire [8:0]  jd     = ic - 9'd65;
    wire [7:0]  jh     = jd[8:1];
    wire        unused = &{1'b0, jd[0]};
    wire [16:0] up_off = ic[0] ? 17'd0 : 17'd192;

    integer i;
    always @(posedge clk) begin
        ar_v <= 1'b0;
        br_v <= 1'b0;
        aw_v <= 1'b0;
        fin  <= 1'b0;
        rq_i <= 16'd0;
        if (rst || kill) begin
            act <= 1'b0;
        end else begin
            if (go) begin
                act <= 1'b1;
                ic  <= 9'd0;
                tw  <= 6'd0;
                cf  <= 8'd0;
            end
            // ---- issue: parameter, 64 table words, then gate/up pairs ----
            if (act && ic != 9'd449) begin
                ic <= ic + 9'd1;
                if (ic == 9'd0) begin
                    br_v <= 1'b1;
                    br_a <= rc;
                    rq_i <= K_PARAM;
                end else if (ic <= 9'd64) begin
                    br_v <= 1'b1;
                    br_a <= rc + {7'd0, ic};     // table word ic - 1 is at rc + 1 + (ic - 1)
                    rq_i <= K_TAB;
                end else begin
                    ar_v <= 1'b1;
                    ar_a <= ra + {9'd0, jh} + up_off;
                    rq_i <= ic[0] ? K_GATE : K_UP;
                end
            end
            // ---- arrivals ----
            if (act && dv) begin
                case (di)
                    K_PARAM: begin m <= dw[15:0]; sh <= dw[21:16]; end
                    K_TAB: begin
                        for (i = 0; i < 4; i = i + 1) tab[{tw, 2'd0} + i[7:0]] <= dw[16*i +: 16];
                        tw <= tw + 6'd1;
                    end
                    K_GATE: gate <= dw;
                    default: begin   // K_UP
                        aw_v <= 1'b1;
                        aw_a <= rb + {9'd0, cf};
                        aw_d <= q;
                        cf   <= cf + 8'd1;
                        if (cf == 8'd191) begin
                            fin <= 1'b1;
                            act <= 1'b0;
                        end
                    end
                endcase
            end
        end
    end

endmodule
