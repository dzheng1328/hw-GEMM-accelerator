"""The milestone 4.2 command processor's instruction set
(docs/specs/2026-09-25-command-processor-cifar10-design.md, section 2):
command encoding, the register map, memory sizes, and the layer shapes the
compiler guarantees. The single source for the compiler, the golden
executor, and the testbenches' disassembler."""

from dataclasses import dataclass

# Opcodes in [63:60]; 0 is invalid, so zeroed program memory faults.
ADD, BLOCK, WAIT, LOOP, ENDLOOP, END, ALU, LOOPR, VOP = 1, 2, 3, 4, 5, 6, 7, 8, 9
OP_NAMES = {ADD: "ADD", BLOCK: "BLOCK", WAIT: "WAIT", LOOP: "LOOP", ENDLOOP: "ENDLOOP", END: "END",
            ALU: "ALU", LOOPR: "LOOPR", VOP: "VOP"}

# Hardware-defined registers; r0 reads as zero.
(ZERO, IN_BASE, OUT_BASE, W_BASE, CIN_LOG2, H_LOG2, W_LOG2, WOUT_LOG2,
 STRIDE, PAD, KSIZE, KS, BIAS, OSTRIDE) = range(14)
# Free registers the compiler uses as per-image pointers: the input's byte
# address and the final output's word address.
IMG_IN, IMG_OUT = 14, 15
# The 4.3 registers (spec 4.3 section 2): the current position, the prompt
# length, the inverse temperature (Q8.8, 0 = argmax), and the register-form
# BLOCK's round, row limit minus 1, and result mode. 22-31 are free.
T, PLEN, INV_TEMP, ROUND, ROWS, RMODE = range(16, 22)
RMODE_RAW, RMODE_Q8, RMODE_Q16 = 0, 1, 2
# The registers of the 4.2 command processor's RTL, until 4.3f widens it to
# N_REGS_LM; the golden executor always has N_REGS_LM.
N_REGS = 16
N_REGS_LM = 32
MAX_LOOP_DEPTH = 4
REG_MASK = 0xFFFF_FFFF

PROGRAM_WORDS = 4096
WEIGHT_WORDS = 65536  # "A memory" from 4.3 on: weights, tables, and the VPU's scratch
ACT_WORDS = 131072
# Fixed addresses the VOPs rely on: the RoPE table (A memory word) and the
# token log (activation word).
A_ROPE = 0
ACT_TOKLOG = 0
# Word-interleaved (bank = word mod 4): a stride-2 gather window spans at
# most 3 consecutive words, which then sit in 3 different banks.
ACT_BANKS = 4
SLOTS_PER_ROUND = 64
TILE = 8
MAX_MESH = 8


@dataclass(frozen=True)
class Block:
    """One round of one output block (spec: BLOCK)."""

    tile_x: int
    tile_y: int
    group: int
    pixel_block: int
    round: int
    ky0: int = 0
    kx0: int = 0
    acc_keep: bool = False
    no_ret: bool = False
    requant: bool = False
    relu: bool = False
    sh: int = 0
    m: int = 0
    reg_form: bool = False


# BLOCK field -> (lsb, width); one-bit fields decode as bool.
BLOCK_FIELDS = {
    "tile_x": (57, 3), "tile_y": (54, 3), "group": (48, 6), "pixel_block": (40, 8),
    "round": (33, 7), "ky0": (30, 3), "kx0": (27, 3), "acc_keep": (26, 1),
    "no_ret": (25, 1), "requant": (24, 1), "relu": (23, 1), "sh": (17, 6), "reg_form": (16, 1), "m": (0, 16),
}
FLAGS = ("acc_keep", "no_ret", "requant", "relu")


def _fit(value, width, name):
    v = int(value)
    if not 0 <= v < (1 << width):
        raise ValueError(f"{name}={value} does not fit in {width} bits")
    return v


def add(dst, src, imm):
    """dst = src + imm (mod 2**32)."""
    if not -(1 << 31) <= imm < (1 << 32):
        raise ValueError(f"imm={imm} does not fit in 32 bits")
    return (ADD << 60) | (_fit(dst, 4, "dst") << 56) | (_fit(src, 4, "src") << 52) | (imm & REG_MASK)


def block(b):
    """A register-form BLOCK (spec section 2) takes its round, row limit, and
    result mode from ROUND, ROWS, and RMODE (golden.py's _resolve is the
    definition), so its own round, no_ret, and requant fields must be zero."""
    if b.reg_form and (b.round or b.no_ret or b.requant):
        raise ValueError("a register-form BLOCK must have round, no_ret, and requant clear")
    word = BLOCK << 60
    for name, (lsb, width) in BLOCK_FIELDS.items():
        word |= _fit(getattr(b, name), width, name) << lsb
    return word


def wait():
    return WAIT << 60


def loop(count):
    if count < 1:
        raise ValueError("LOOP count must be at least 1")
    return (LOOP << 60) | _fit(count, 16, "count")


def endloop():
    return ENDLOOP << 60


def end():
    return END << 60


# ALU operations in [49:48].
ALU_ADD, ALU_SUB, ALU_SHR, ALU_AND = range(4)
ALU_NAMES = {ALU_ADD: "add", ALU_SUB: "sub", ALU_SHR: "shr", ALU_AND: "and"}
# VOP sub-ops in [59:56]; 0 and 10-15 are invalid.
EMBED, RMSNORM, ROPE, KVWRITE, SOFTMAX, SILU_MUL, VADD, TRANSPOSE, SAMPLE = range(1, 10)
VOP_NAMES = {EMBED: "EMBED", RMSNORM: "RMSNORM", ROPE: "ROPE", KVWRITE: "KVWRITE", SOFTMAX: "SOFTMAX",
             SILU_MUL: "SILU_MUL", VADD: "ADD", TRANSPOSE: "TRANSPOSE", SAMPLE: "SAMPLE"}


@dataclass(frozen=True)
class Alu:
    """dst = src op (src2 register, or imm when src2 is None); 32-bit wrap."""

    op: int
    dst: int
    src: int
    src2: int | None = None
    imm: int | None = None


@dataclass(frozen=True)
class Vop:
    """One vector command: the sub-op and up to three operand registers
    (what each means is per sub-op, in golden_vop.py)."""

    sub: int
    ra: int = 0
    rb: int = 0
    rc: int = 0


def alu(op, dst, src, src2=None, imm=None):
    if (src2 is None) == (imm is None):
        raise ValueError("ALU takes exactly one of src2 and imm")
    word = (ALU << 60) | (_fit(dst, 5, "dst") << 55) | (_fit(src, 5, "src") << 50) | (_fit(op, 2, "op") << 48)
    if src2 is not None:
        return word | (_fit(src2, 5, "src2") << 42)
    if not -(1 << 31) <= imm < (1 << 32):
        raise ValueError(f"imm={imm} does not fit in 32 bits")
    return word | (1 << 47) | (imm & REG_MASK)


def loopr(reg):
    """LOOP whose count is register reg's value; a count of 0 skips the body."""
    return (LOOPR << 60) | (_fit(reg, 5, "reg") << 55)


def vop(sub, ra=0, rb=0, rc=0):
    return ((VOP << 60) | (_fit(sub, 4, "sub") << 56) | (_fit(ra, 5, "ra") << 51) | (_fit(rb, 5, "rb") << 46)
            | (_fit(rc, 5, "rc") << 41))


def decode(word):
    """(opcode, operands): (dst, src, imm) for ADD, a Block for BLOCK, the
    count for LOOP, an Alu for ALU, the register for LOOPR, a Vop for VOP,
    None for the rest and for invalid opcodes."""
    word = int(word)
    op = word >> 60
    if op == ADD:
        return op, ((word >> 56) & 0xF, (word >> 52) & 0xF, word & REG_MASK)
    if op == BLOCK:
        f = {n: (word >> lsb) & ((1 << w) - 1) for n, (lsb, w) in BLOCK_FIELDS.items()}
        return op, Block(**{n: bool(v) if BLOCK_FIELDS[n][1] == 1 else v for n, v in f.items()})
    if op == LOOP:
        return op, word & 0xFFFF
    if op == ALU:
        use_imm = (word >> 47) & 1
        return op, Alu((word >> 48) & 3, (word >> 55) & 0x1F, (word >> 50) & 0x1F,
                       None if use_imm else (word >> 42) & 0x1F, word & REG_MASK if use_imm else None)
    if op == LOOPR:
        return op, (word >> 55) & 0x1F
    if op == VOP:
        return op, Vop((word >> 56) & 0xF, (word >> 51) & 0x1F, (word >> 46) & 0x1F, (word >> 41) & 0x1F)
    return op, None


def disassemble(word):
    op, arg = decode(word)
    if op not in OP_NAMES:
        return f"INVALID {int(word):016x}"
    if op == ADD:
        return f"ADD r{arg[0]}, r{arg[1]}, {arg[2]}"
    if op == BLOCK:
        flags = ",".join(f for f in FLAGS + ("reg_form",) if getattr(arg, f))
        return (f"BLOCK tile=({arg.tile_x},{arg.tile_y}) g={arg.group} pb={arg.pixel_block} r={arg.round} "
                f"tap0=({arg.ky0},{arg.kx0}) m={arg.m} sh={arg.sh}" + (f" {flags}" if flags else ""))
    if op == LOOP:
        return f"LOOP {arg}"
    if op == ALU:
        rhs = f"r{arg.src2}" if arg.src2 is not None else str(arg.imm)
        return f"ALU r{arg.dst} = r{arg.src} {ALU_NAMES[arg.op]} {rhs}"
    if op == LOOPR:
        return f"LOOPR r{arg}"
    if op == VOP:
        name = VOP_NAMES.get(arg.sub)
        return f"VOP {name} r{arg.ra}, r{arg.rb}, r{arg.rc}" if name else f"VOP INVALID({arg.sub})"
    return OP_NAMES[op]


class ShapeError(ValueError):
    """A layer outside the shapes the hardware supports (spec section 1)."""


def is_pow2(n):
    return n >= 1 and n & (n - 1) == 0


def log2(n):
    return int(n).bit_length() - 1


def conv_out(size, ksize, stride, pad):
    return (size + 2 * pad - ksize) // stride + 1


def check_shape(name, cin, h, w, cout, ksize, stride, pad):
    """(Hout, Wout) of a layer, or ShapeError naming the violated rule."""

    def bad(msg):
        raise ShapeError(f"{name}: {msg}")

    if not (is_pow2(cin) and is_pow2(h) and is_pow2(w)):
        bad(f"Cin, H, W must be powers of two, got {cin}, {h}, {w}")
    if w % TILE:
        bad(f"W={w} must be a multiple of 8 so every row starts word-aligned")
    if stride not in (1, 2) or pad not in (0, 1):
        bad(f"stride must be 1 or 2 and pad 0 or 1, got {stride}, {pad}")
    if not 1 <= ksize <= TILE:
        bad(f"KSIZE={ksize} must be 1..8")
    if cout % TILE or not TILE <= cout <= 512:
        bad(f"Cout={cout} must be a multiple of 8 in 8..512")
    hout, wout = conv_out(h, ksize, stride, pad), conv_out(w, ksize, stride, pad)
    if hout < 1 or wout < 1:
        bad(f"kernel {ksize} does not fit a {h}x{w} input")
    if wout == 1:
        if hout != 1:
            bad(f"an output with Wout=1 must have Hout=1, got {hout}")
    elif not (is_pow2(wout) and wout >= TILE):
        bad(f"Wout={wout} must be 1 or a power of two >= 8")
    if hout * wout > 256 * TILE:
        bad(f"{hout * wout // TILE} pixel blocks exceed the 256 a BLOCK can address")
    return hout, wout
