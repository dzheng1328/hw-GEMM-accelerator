"""Random quantized conv stacks for compiler tests, in the tensor layout of
model/cifar_quantized.npz, scaled so activations spread across int8 instead
of saturating."""

import numpy as np

from cifar_spec import Layer
from fixedpoint import quantize_multiplier

# name -> (input shape, [(cout, ksize, stride, pad), ...]); the last layer is raw.
NETS = {
    # conv, stride-2 conv, 8x8 classifier: the CIFAR pattern in miniature.
    "small": ((4, 16, 16), [(8, 3, 1, 1), (16, 3, 2, 1), (16, 8, 1, 0)]),
    # Cin 128 (a tap spans two rounds), a 1x1 conv, and a raw output with Wout 8.
    "wide": ((128, 16, 16), [(8, 3, 2, 1), (16, 1, 1, 0), (16, 3, 1, 1)]),
}


def random_net(rng, input_shape, specs):
    q, layers = {}, []
    cin = input_shape[0]
    x_std = 74.0  # int8 input spread over [-128, 127]
    for i, (cout, k, stride, pad) in enumerate(specs):
        name, taps = f"l{i}", cin * k * k
        q[f"{name}_w"] = rng.integers(-127, 128, (cout, cin, k, k)).astype(np.int8)
        q[f"{name}_bias"] = rng.integers(-16, 17, (8 - taps % 8, cout)).astype(np.int8)
        q[f"{name}_bias_val"] = int(rng.integers(1, 128))
        if i < len(specs) - 1:
            target = 40.0 / (np.sqrt(taps) * x_std * 73.0)
            mults = [quantize_multiplier(target * rng.uniform(0.5, 2.0)) for _ in range(cout // 8)]
            q[f"{name}_m"] = np.array([m for m, _ in mults])
            q[f"{name}_sh"] = np.array([sh for _, sh in mults])
            x_std = 30.0  # post-ReLU
        layers.append(Layer(name, cin, cout, k, stride, pad))
        cin = cout
    return q, layers
