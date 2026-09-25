"""The CIFAR-10 network's shape, torch-free so the NumPy int8 reference,
the compiler, and testbenches can import it without loading PyTorch
(model/cifar_net.py builds the trainable model from the same table)."""

from collections import namedtuple

Layer = namedtuple("Layer", "name cin cout ksize stride pad")

# Spec section 1: five 3x3 convs (stride 2 in place of pooling) and an 8x8
# 'valid' conv as the classifier, so every layer is one GEMM.
LAYERS = [
    Layer("conv1", 3, 16, 3, 1, 1),
    Layer("conv2", 16, 32, 3, 2, 1),
    Layer("conv3", 32, 32, 3, 1, 1),
    Layer("conv4", 32, 64, 3, 2, 1),
    Layer("conv5", 64, 64, 3, 1, 1),
    Layer("fc", 64, 10, 8, 1, 0),
]
INPUT_OFFSET = 128  # q_in = pixel - 128; float input = q_in / 128, exactly
