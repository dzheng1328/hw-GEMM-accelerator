"""The trainable CIFAR-10 network co-designed for the chip (shape in
model/cifar_spec.py): five 3x3 convs with BatchNorm and ReLU, stride 2
instead of pooling, and an 8x8 'valid' conv as the classifier, so every
layer is one GEMM followed by the on-chip requant path."""

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

from cifar_spec import INPUT_OFFSET, LAYERS, Layer  # noqa: F401 (re-exported)


class CifarNet(nn.Module):
    def __init__(self):
        super().__init__()
        convs = LAYERS[:-1]
        self.convs = nn.ModuleList(nn.Conv2d(l.cin, l.cout, l.ksize, l.stride, l.pad, bias=False) for l in convs)
        self.bns = nn.ModuleList(nn.BatchNorm2d(l.cout) for l in convs)
        fc = LAYERS[-1]
        self.fc = nn.Conv2d(fc.cin, fc.cout, fc.ksize, fc.stride, fc.pad, bias=True)

    def features(self, x):
        """Post-ReLU output of every conv layer, then the fc logits."""
        outs = []
        for conv, bn in zip(self.convs, self.bns):
            x = F.relu(bn(conv(x)))
            outs.append(x)
        outs.append(self.fc(x).flatten(1))
        return outs

    def forward(self, x):
        return self.features(x)[-1]


def to_input(images_uint8: np.ndarray) -> torch.Tensor:
    return (torch.from_numpy(np.asarray(images_uint8)).float() - INPUT_OFFSET) / INPUT_OFFSET


def fold_bn(conv_w: torch.Tensor, bn: nn.BatchNorm2d):
    """Eval-mode BatchNorm folded into the conv: bn(conv(x)) = conv_W(x) + b."""
    scale = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach().double()
    W = conv_w.detach().double() * scale[:, None, None, None]
    b = bn.bias.detach().double() - bn.running_mean.detach().double() * scale
    return W.numpy(), b.numpy()


def folded_layers(model: CifarNet):
    """(W, b) float64 per layer: BatchNorm folded for the convs, the fc's own."""
    out = [fold_bn(conv.weight, bn) for conv, bn in zip(model.convs, model.bns)]
    out.append((model.fc.weight.detach().double().numpy(), model.fc.bias.detach().double().numpy()))
    return out
