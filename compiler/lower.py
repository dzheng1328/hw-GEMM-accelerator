"""Lower a quantized conv stack to the command processor's terms (spec
sections 1-2): per-layer register values and round geometry, the packed
weight memory, and the activation memory map.

A network is (q, layers, input_shape). q holds, per layer name L, int8
weights L_w (Cout, Cin, k, k), int8 bias rows L_bias (n_slots, Cout), the
constant L_bias_val, and for every layer but the last the per-group L_m and
L_sh (the model/cifar_quantized.npz layout). layers are cifar_spec.Layer
rows; channel counts come from the tensors (already padded), the kernel,
stride, and pad from the rows. Every layer but the last requantizes with
ReLU to int8; the last returns raw int32, as model/cifar_reference.run_layers.

Activation memory: every image's input from word 0, then one buffer per
intermediate layer (reused by every image), then every image's final output."""

from dataclasses import dataclass

import numpy as np

import isa


@dataclass(frozen=True)
class LayerPlan:
    name: str
    cin: int
    h: int
    w: int
    cout: int
    hout: int
    wout: int
    ksize: int
    stride: int
    pad: int
    tap_slots: int
    ks: int
    bias_val: int
    raw: bool
    m: tuple
    sh: tuple
    w_base: int  # weight word address
    in_base: int  # byte address (image 0's input for the first layer)
    out_base: int  # word address (image 0's output for the last layer)

    @property
    def groups(self):
        return self.cout // isa.TILE

    @property
    def pixel_blocks(self):
        """Pixel blocks per output channel, which is also OSTRIDE."""
        return max(1, self.hout * self.wout // isa.TILE)

    @property
    def rounds(self):
        return -(-self.ks // isa.SLOTS_PER_ROUND)

    @property
    def out_words(self):
        """Output words per image: one word per 8 int8 pixels, or one word
        per raw cell (8 cells per pixel block)."""
        return self.cout * self.pixel_blocks * (isa.TILE if self.raw else 1)

    def round_start_tap(self, r):
        """(ky0, kx0) of round r's first slot; (0, 0) for a round that starts
        in the bias slots, where the DMA ignores the tap."""
        k0 = isa.SLOTS_PER_ROUND * r
        if k0 >= self.tap_slots:
            return 0, 0
        return divmod(k0 >> isa.log2(self.cin), self.ksize)

    def regs(self):
        return {
            isa.IN_BASE: self.in_base, isa.OUT_BASE: self.out_base, isa.W_BASE: self.w_base,
            isa.CIN_LOG2: isa.log2(self.cin), isa.H_LOG2: isa.log2(self.h), isa.W_LOG2: isa.log2(self.w),
            isa.WOUT_LOG2: isa.log2(self.wout), isa.STRIDE: self.stride, isa.PAD: self.pad,
            isa.KSIZE: self.ksize, isa.KS: self.ks, isa.BIAS: self.tap_slots | (self.bias_val << 16),
            isa.OSTRIDE: self.pixel_blocks,
        }


@dataclass(frozen=True)
class MemMap:
    n_images: int
    input_base: int
    input_words: int
    output_base: int
    output_words: int
    total_words: int


@dataclass(frozen=True)
class Lowered:
    layers: tuple
    weights: np.ndarray
    mem: MemMap


def pack_weights(wq, bias):
    """Weight words for one layer: word group * KS + k holds output channels
    8 * group .. 8 * group + 7 (byte i = channel 8 * group + i) at slot k,
    with the taps in (ky, kx, c) order and then one bias row per bias slot."""
    cout, cin, k, _ = wq.shape
    taps = np.asarray(wq, dtype=np.int8).transpose(0, 2, 3, 1).reshape(cout, k * k * cin)
    cols = np.concatenate([taps, np.asarray(bias, dtype=np.int8).T], axis=1)
    lanes = cols.reshape(cout // isa.TILE, isa.TILE, -1).transpose(0, 2, 1)
    return np.ascontiguousarray(lanes).view("<u8").reshape(-1)


def lower(q, layers, input_shape, n_images):
    if n_images < 1:
        raise ValueError("need at least one image")
    cin, h, w = input_shape
    input_words = cin * h * w // isa.TILE
    act_next = n_images * input_words
    w_next, in_base = 0, 0
    plans, packed = [], []
    for i, layer in enumerate(layers):
        L, last = layer.name, i == len(layers) - 1
        wq = np.asarray(q[f"{L}_w"])
        cout, wc, ksize, ksize2 = wq.shape
        if (wc, ksize, ksize2) != (cin, layer.ksize, layer.ksize):
            raise isa.ShapeError(f"{L}: weights {wq.shape} do not match a {cin}-channel input and kernel {layer.ksize}")
        hout, wout = isa.check_shape(L, cin, h, w, cout, ksize, layer.stride, layer.pad)
        bias = np.asarray(q[f"{L}_bias"])
        tap_slots = cin * ksize * ksize
        if bias.ndim != 2 or bias.shape[1] != cout or not bias.shape[0] or (tap_slots + bias.shape[0]) % isa.TILE:
            raise isa.ShapeError(f"{L}: bias rows {bias.shape} must end K on a multiple of 8 after {tap_slots} tap slots")
        ks = tap_slots + bias.shape[0]
        if tap_slots >= 1 << 16 or -(-ks // isa.SLOTS_PER_ROUND) > 128:
            raise isa.ShapeError(f"{L}: K={ks} exceeds the BIAS field or the 128 rounds a BLOCK can address")
        bias_val = int(q[f"{L}_bias_val"])
        if not 1 <= bias_val <= 127:
            raise ValueError(f"{L}: bias_val {bias_val} outside 1..127")
        m = sh = ()
        if not last:
            m, sh = tuple(int(v) for v in q[f"{L}_m"]), tuple(int(v) for v in q[f"{L}_sh"])
            if len(m) != cout // isa.TILE or len(sh) != len(m):
                raise ValueError(f"{L}: need one (m, sh) per 8-channel group")
        plan = LayerPlan(L, cin, h, w, cout, hout, wout, ksize, layer.stride, layer.pad, tap_slots, ks,
                         bias_val, last, m, sh, w_next, in_base, act_next)
        act_next += plan.out_words * (n_images if last else 1)
        w_next += plan.groups * ks
        packed.append(pack_weights(wq, bias))
        plans.append(plan)
        in_base, (cin, h, w) = plan.out_base * isa.TILE, (cout, hout, wout)
    if act_next > isa.ACT_WORDS:
        raise ValueError(f"network needs {act_next} activation words; activation memory holds {isa.ACT_WORDS}")
    if w_next > isa.WEIGHT_WORDS:
        raise ValueError(f"network needs {w_next} weight words; weight memory holds {isa.WEIGHT_WORDS}")
    out = plans[-1]
    mem = MemMap(n_images, 0, input_words, out.out_base, out.out_words, act_next)
    return Lowered(tuple(plans), np.concatenate(packed), mem)


def pack_inputs(lowered, x):
    """Initial activation memory ('<u8' words, mem.total_words): image n's
    int8 input in CHW order at word input_base + n * input_words."""
    mem, first = lowered.mem, lowered.layers[0]
    x = np.asarray(x)
    if x.shape != (mem.n_images, first.cin, first.h, first.w):
        raise ValueError(f"input shape {x.shape}, lowered for {(mem.n_images, first.cin, first.h, first.w)}")
    if x.size and (x.min() < -128 or x.max() > 127):
        raise ValueError("inputs must be int8")
    act = np.zeros(mem.total_words * isa.TILE, dtype=np.int8)
    start = mem.input_base * isa.TILE
    act[start : start + x.size] = x.reshape(-1)
    return act.view("<u8")


def _cells(L, act_bytes, word, raw):
    act = np.asarray(act_bytes, dtype=np.uint8)
    n = L.cout * L.pixel_blocks * isa.TILE
    if raw:
        cells = act.view("<i8")[word : word + n]
    else:
        cells = act[word * isa.TILE : word * isa.TILE + n].view(np.int8)
    npix = L.hout * L.wout
    return cells.reshape(L.cout, -1)[:, :npix].reshape(L.cout, L.hout, L.wout).astype(np.int64)


def read_output(lowered, act_bytes, image):
    """One image's raw final output (Cout, Hout, Wout) from activation memory."""
    L = lowered.layers[-1]
    return _cells(L, act_bytes, L.out_base + image * L.out_words, raw=True)


def read_buffer(lowered, act_bytes, i):
    """Intermediate layer i's int8 output (Cout, Hout, Wout); buffers are
    reused, so this is the last image's."""
    L = lowered.layers[i]
    if L.raw:
        raise ValueError("use read_output for the last layer")
    return _cells(L, act_bytes, L.out_base, raw=False)
