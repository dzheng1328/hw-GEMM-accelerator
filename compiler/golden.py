"""ISA-level golden executor, level 2 of the verification ladder (spec
section 4): runs a program on the program, weight, and activation memory
images with the spec's gather, requant, and write-back semantics. The RTL's
final activation memory must equal this executor's bit for bit.

It executes commands one at a time and completes each BLOCK at once, so it
also enforces the ordering rules the RTL relies on but does not check: a
BLOCK must not read a word that an outstanding returning BLOCK (one not yet
covered by a WAIT or END) writes, and two outstanding BLOCKs must not write
the same word."""

from dataclasses import replace

import numpy as np

import golden_vop
import isa
from fixedpoint import requant, requant16


class GoldenError(Exception):
    """A hardware fault, or a broken ordering rule, at program counter pc."""

    def __init__(self, pc, msg):
        super().__init__(f"pc {pc}: {msg}")
        self.pc = pc


def _load(words, depth, name):
    words = np.asarray(words, dtype="<u8")
    if len(words) > depth:
        raise ValueError(f"{name} image has {len(words)} words; memory holds {depth}")
    mem = np.zeros(depth, dtype="<u8")
    mem[: len(words)] = words
    return mem


class Golden:
    def __init__(self, mesh_w, mesh_h, program, weights, act):
        self.mesh = (mesh_w, mesh_h)
        self.prog = _load(program, isa.PROGRAM_WORDS, "program")
        self.wmem = _load(weights, isa.WEIGHT_WORDS, "weight")
        self.act = _load(act, isa.ACT_WORDS, "activation").view(np.uint8)
        self.actw = self.act.view("<u8")  # the same memory, a word at a time
        self.regs = [0] * isa.N_REGS_LM
        self.acc = {}
        # pc of the outstanding BLOCK that writes each activation word, or -1.
        self.pending = np.full(isa.ACT_WORDS, -1, dtype=np.int64)
        self.pending_words = []

    def run(self, max_commands=10_000_000):
        """Execute from pc 0 through END; returns the activation memory bytes."""
        pc, loops = 0, []
        for _ in range(max_commands):
            if pc >= isa.PROGRAM_WORDS:
                raise GoldenError(pc, "ran past the end of program memory")
            op, arg = isa.decode(int(self.prog[pc]))
            nxt = pc + 1
            if op == isa.ADD:
                dst, src, imm = arg
                if dst:
                    self.regs[dst] = (self.regs[src] + imm) & isa.REG_MASK
            elif op == isa.ALU:
                self._alu(arg)
            elif op == isa.BLOCK:
                self._block(pc, arg)
            elif op == isa.VOP:
                self._retire()  # a VOP drains every outstanding BLOCK, like WAIT, before it starts
                golden_vop.execute(self, pc, arg)
            elif op == isa.WAIT:
                self._retire()
            elif op in (isa.LOOP, isa.LOOPR):
                count = arg if op == isa.LOOP else self.regs[arg]
                if op == isa.LOOP and count == 0:
                    raise GoldenError(pc, "LOOP count 0")
                if count > 0xFFFF:
                    raise GoldenError(pc, f"LOOPR count {count} does not fit in 16 bits")
                if count == 0:
                    nxt = self._after_body(pc)
                elif len(loops) == isa.MAX_LOOP_DEPTH:
                    raise GoldenError(pc, f"LOOP nested deeper than {isa.MAX_LOOP_DEPTH}")
                else:
                    loops.append([nxt, count])
            elif op == isa.ENDLOOP:
                if not loops:
                    raise GoldenError(pc, "ENDLOOP without an active LOOP")
                loops[-1][1] -= 1
                if loops[-1][1]:
                    nxt = loops[-1][0]
                else:
                    loops.pop()
            elif op == isa.END:
                self._retire()
                return self.act
            else:
                raise GoldenError(pc, f"invalid opcode {op}")
            pc = nxt
        raise GoldenError(pc, f"no END within {max_commands} commands")

    def _alu(self, a):
        if not a.dst:
            return
        x, y = self.regs[a.src], a.imm if a.src2 is None else self.regs[a.src2]
        r = {isa.ALU_ADD: x + y, isa.ALU_SUB: x - y, isa.ALU_SHR: x >> (y & 31), isa.ALU_AND: x & y}[a.op]
        self.regs[a.dst] = r & isa.REG_MASK

    def _after_body(self, pc):
        """The pc after the ENDLOOP matching the LOOPR at pc (a count of 0 skips the body)."""
        depth = 1
        for i in range(pc + 1, isa.PROGRAM_WORDS):
            op = int(self.prog[i]) >> 60
            depth += (op in (isa.LOOP, isa.LOOPR)) - (op == isa.ENDLOOP)
            if not depth:
                return i + 1
        raise GoldenError(pc, "LOOPR without a matching ENDLOOP")

    def _retire(self):
        for words in self.pending_words:
            self.pending[words] = -1
        self.pending_words.clear()

    def _resolve(self, pc, b):
        """(block, rows, q16): a register-form BLOCK with its round, flags, and
        result mode filled in from the registers (spec section 2), and the
        rows it returns; any other BLOCK unchanged, 8 rows, RESULT8 or raw.
        Register form: round = ROUND; rows = ROWS + 1; RMODE picks raw,
        RESULT8, or RESULT16 (relu applies to RESULT8 only); the partial sum
        accumulates when the BLOCK's acc_keep is set or ROUND > 0; and only
        the last round of KS slots returns."""
        if not b.reg_form:
            return b, 8, False
        R = self.regs
        if R[isa.ROUND] >= 1 << 7:
            raise GoldenError(pc, f"register-form ROUND {R[isa.ROUND]} out of range")
        if R[isa.ROWS] > 7:
            raise GoldenError(pc, f"register-form ROWS {R[isa.ROWS]} out of range (rows minus 1, 0..7)")
        if R[isa.RMODE] > isa.RMODE_Q16:
            raise GoldenError(pc, f"register-form RMODE {R[isa.RMODE]} out of range")
        rnd, mode = R[isa.ROUND], R[isa.RMODE]
        final = isa.SLOTS_PER_ROUND * (rnd + 1) >= R[isa.KS]
        b = replace(b, round=rnd, acc_keep=b.acc_keep or rnd > 0, no_ret=not final, requant=mode != isa.RMODE_RAW,
                    reg_form=False)
        return b, R[isa.ROWS] + 1, mode == isa.RMODE_Q16

    def _block(self, pc, b):
        b, rows, q16 = self._resolve(pc, b)
        if b.tile_x >= self.mesh[0] or b.tile_y >= self.mesh[1]:
            raise GoldenError(pc, f"tile ({b.tile_x}, {b.tile_y}) is outside the {self.mesh[0]}x{self.mesh[1]} mesh")
        a, bmat = self.operands(b, pc)
        tile = (b.tile_x, b.tile_y)
        acc = self.acc.get(tile, np.zeros((8, 8), np.int64)) if b.acc_keep else np.zeros((8, 8), np.int64)
        acc = acc + a.T @ bmat
        if acc.max() >= 2**31 or acc.min() < -(2**31):
            raise GoldenError(pc, "accumulator outside int32")
        self.acc[tile] = acc
        if not b.no_ret:
            self._write_back(pc, b, acc, rows, q16)

    def operands(self, b, pc=0):
        """(a, bmat), each (n, 8) int64: the A columns and B rows the DMA
        streams for BLOCK b's round under the current registers and memories
        (row k = slot 64 * round + k). Faults like the BLOCK itself would."""
        ks = self.regs[isa.KS]
        k0 = isa.SLOTS_PER_ROUND * b.round
        n = min(isa.SLOTS_PER_ROUND, ks - k0)
        if ks % isa.TILE or n <= 0:
            raise GoldenError(pc, f"round {b.round} is outside KS={ks} (a positive multiple of 8)")
        if self.regs[isa.KSIZE] == 0:
            raise GoldenError(pc, "KSIZE is 0")
        self._check_tap(pc, b, k0)
        return self._a_words(pc, b, ks, k0, n), self._gather(pc, b, k0, n)

    def _check_tap(self, pc, b, k0):
        """(ky0, kx0) must be the tap of the round's first slot, each below
        KSIZE, or (0, 0) for a round that starts in the bias slots: the DMA
        loads them into separate ky/kx counters and never checks them."""
        ksize, bias_start = self.regs[isa.KSIZE], self.regs[isa.BIAS] & 0xFFFF
        if k0 < bias_start:
            want = divmod(k0 >> self.regs[isa.CIN_LOG2], ksize)
        else:
            want = (0, 0)
        if (b.ky0, b.kx0) != want:
            raise GoldenError(pc, f"BLOCK tap ({b.ky0}, {b.kx0}) does not start round {b.round}; expected {want}")

    def _a_words(self, pc, b, ks, k0, n):
        """(n, 8): row k is slot k's A column, lane i = output channel 8g + i."""
        addr = self.regs[isa.W_BASE] + b.group * ks + k0 + np.arange(n)
        if addr[-1] >= isa.WEIGHT_WORDS:
            raise GoldenError(pc, "weight address past weight memory")
        return self.wmem[addr].view(np.int8).reshape(n, 8).astype(np.int64)

    def _gather(self, pc, b, k0, n):
        """(n, 8): row k is slot k's B row (spec: gather semantics)."""
        R = self.regs
        cin_log2, h_log2, w_log2, wout_log2 = R[isa.CIN_LOG2], R[isa.H_LOG2], R[isa.W_LOG2], R[isa.WOUT_LOG2]
        ksize, stride, pad = R[isa.KSIZE], R[isa.STRIDE], R[isa.PAD]
        bias_start, bias_val = R[isa.BIAS] & 0xFFFF, (R[isa.BIAS] >> 16) & 0xFF
        bias_val -= 256 if bias_val >= 128 else 0
        cmask = (1 << cin_log2) - 1
        j = np.arange(n)
        c = (k0 + j) & cmask
        # The DMA's tap counter: start at (ky0, kx0), advance when c wraps.
        tap = b.ky0 * ksize + b.kx0 + (((k0 & cmask) + j) >> cin_log2)
        ky, kx = tap // ksize, tap % ksize
        lane = np.arange(8)
        lane_ok = lane >= 0 if wout_log2 else lane == 0
        p = 8 * b.pixel_block + lane
        oy, ox = p >> wout_log2, p & ((1 << wout_log2) - 1)
        iy = oy[None, :] * stride + ky[:, None] - pad
        ix = ox[None, :] * stride + kx[:, None] - pad
        is_tap = (k0 + j < bias_start)[:, None]
        read = is_tap & lane_ok & (iy >= 0) & (iy < (1 << h_log2)) & (ix >= 0) & (ix < (1 << w_log2))
        addr = R[isa.IN_BASE] + (c[:, None] << (h_log2 + w_log2)) + (iy << w_log2) + ix
        out = np.zeros((n, 8), np.int64)
        words = addr >> 3
        span = np.where(read, words, -1).max(axis=1) - np.where(read, words, 1 << 62).min(axis=1)
        if (span >= isa.ACT_BANKS - 1).any():
            k = k0 + int(np.argmax(span >= isa.ACT_BANKS - 1))
            raise GoldenError(pc, f"slot {k} reads more than 3 consecutive words, past the one-cycle bank window")
        ra = addr[read]
        if ra.size:
            if ra.max() >= len(self.act):
                raise GoldenError(pc, "gather address past activation memory")
            writer = self.pending[ra >> 3]
            if (writer >= 0).any():
                word = int(ra[writer >= 0][0] >> 3)
                raise GoldenError(pc, f"reads activation word {word}, which the BLOCK at pc {self.pending[word]} writes, before a WAIT")
            out[read] = self.act[ra].view(np.int8)
        out[~is_tap & lane_ok] = bias_val
        return out

    def result_words(self, b, rows=8, q16=False):
        """Activation word addresses BLOCK b's results land at under the
        current registers (spec: write-back), for its first `rows` rows: one
        word per RESULT8 row, two per RESULT16 row (half h of row i at
        base + i * OSTRIDE + h), or 8 raw cells per row, in row-major order."""
        out, ostride = self.regs[isa.OUT_BASE], self.regs[isa.OSTRIDE]
        idx = 8 * b.group + np.arange(rows)
        if q16:
            return (out + idx[:, None] * ostride + b.pixel_block + np.arange(2)[None, :]).reshape(-1)
        if b.requant:
            return out + idx * ostride + b.pixel_block
        return (out + (idx[:, None] * ostride + b.pixel_block) * 8 + np.arange(8)[None, :]).reshape(-1)

    def _write_back(self, pc, b, acc, rows, q16):
        words = self.result_words(b, rows, q16)
        acc = acc[:rows]
        if q16:
            data = np.ascontiguousarray(requant16(acc, b.m, b.sh).astype("<i2")).view("<u8").reshape(-1)
        elif b.requant:
            data = np.ascontiguousarray(requant(acc, b.m, b.sh, b.relu).astype(np.int8)).view("<u8").reshape(-1)
        else:
            data = acc.reshape(-1).astype(np.int64).view("<u8")
        if words.max() >= isa.ACT_WORDS:
            raise GoldenError(pc, "write-back address past activation memory")
        writer = self.pending[words]
        if (writer >= 0).any():
            word = int(words[writer >= 0][0])
            raise GoldenError(pc, f"writes activation word {word}, which the BLOCK at pc {self.pending[word]} also writes, before a WAIT")
        self.pending[words] = pc
        self.pending_words.append(words)
        self.act.view("<u8")[words] = data


class Tracer(Golden):
    """A Golden that also records what the command processor's RTL must do,
    for the testbenches. After run(): blocks holds every executed BLOCK as
    (pc, block, registers, epoch, words) -- the 16 registers when it ran,
    the number of WAITs and ENDs executed before it, and the activation
    words it writes back (None for no_ret); slots and wb_words are the total
    OPERAND slots streamed and words written back."""

    def __init__(self, mesh_w, mesh_h, program, weights, act):
        super().__init__(mesh_w, mesh_h, program, weights, act)
        self.blocks, self.epoch, self.slots, self.wb_words = [], 0, 0, 0

    def operands(self, b, pc=0):
        a, bmat = super().operands(b, pc)
        self.slots += len(a)
        return a, bmat

    def _block(self, pc, b):
        rb, rows, q16 = self._resolve(pc, b)
        super()._block(pc, b)
        words = None if rb.no_ret else self.result_words(rb, rows, q16)
        self.blocks.append((pc, b, tuple(self.regs[: isa.N_REGS]), self.epoch, words))
        self.wb_words += 0 if words is None else len(words)

    def _retire(self):
        super()._retire()
        self.epoch += 1
