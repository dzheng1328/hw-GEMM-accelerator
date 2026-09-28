"""Shape of the 4.3 story model (spec section 1), shared by the float net,
the integer reference, and the compiler without importing torch."""

DIM = 64
N_LAYERS = 5
N_HEADS = 8
N_KV_HEADS = 4
HEAD_DIM = DIM // N_HEADS  # 8: one head is one 8-wide tile dimension
KV_DIM = N_KV_HEADS * HEAD_DIM  # 32
HIDDEN = 192  # SwiGLU width, a multiple of 8
VOCAB = 512
CTX = 256
BATCH = 8  # stories decoded in parallel, one per B lane
GROUP = 8  # output channels per requant group (one GO)
BOS, EOS = 1, 2  # SentencePiece defaults; BOS also delimits stories (llama2.c)
ROPE_THETA = 10000.0
NORM_EPS = 1e-5
PROMPT = "Once upon a time"
