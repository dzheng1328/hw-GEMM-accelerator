"""Train a tiny MLP on downsampled MNIST for the Phase 1 hardware demo.

Architecture is deliberately constrained by rtl/pe.v's capabilities:
  - No bias, no BatchNorm/Dropout: the PE has no add-constant datapath, so a
    trained bias literally cannot be represented in hardware.
  - Hidden width 32 and input width 64 (8x8 downsampled from 28x28) are
    chosen so the two layers tile cleanly into a small number of 8x8x8
    systolic-array "waves" (see docs/decisions.md) -- this task's pass
    criterion is bit-exact hardware-vs-software matching, not accuracy, so a
    smaller/less accurate model loses nothing here.
  - Trained on raw 0-255 pixel floats (not /255-normalized), so the fixed
    input quantization scale used later (255/127) matches what the model
    actually sees.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

from mnist_data import load_mnist

CHECKPOINT_DIR = __import__("pathlib").Path(__file__).parent / "checkpoints"
CHECKPOINT_PATH = CHECKPOINT_DIR / "mlp_float.pt"

INPUT_DIM = 64  # 8x8 downsampled
HIDDEN_DIM = 32
OUTPUT_DIM = 10

EPOCHS = 10
BATCH_SIZE = 128
LEARNING_RATE = 1e-3


class MnistMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(INPUT_DIM, HIDDEN_DIM, bias=False)
        self.fc2 = nn.Linear(HIDDEN_DIM, OUTPUT_DIM, bias=False)

    def forward(self, x):
        h = F.relu(self.fc1(x))
        return self.fc2(h)


def downsample(images_uint8: torch.Tensor) -> torch.Tensor:
    """(N, 28, 28) uint8 in [0,255] -> (N, 64) float32 in [0,255], via
    area-weighted average pooling (handles the non-integer 28/8=3.5 ratio
    correctly; a naive strided slice would silently drop most pixels)."""
    x = images_uint8.float().unsqueeze(1)  # (N, 1, 28, 28)
    pooled = F.adaptive_avg_pool2d(x, (8, 8))  # (N, 1, 8, 8)
    return pooled.view(pooled.shape[0], -1)  # (N, 64)


def main():
    train_images, train_labels, test_images, test_labels = load_mnist()

    train_x = downsample(torch.from_numpy(train_images))
    train_y = torch.from_numpy(train_labels.astype("int64"))
    test_x = downsample(torch.from_numpy(test_images))
    test_y = torch.from_numpy(test_labels.astype("int64"))

    model = MnistMLP()
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)

    n_train = train_x.shape[0]
    for epoch in range(EPOCHS):
        perm = torch.randperm(n_train)
        total_loss = 0.0
        for start in range(0, n_train, BATCH_SIZE):
            idx = perm[start : start + BATCH_SIZE]
            xb, yb = train_x[idx], train_y[idx]

            optimizer.zero_grad()
            logits = model(xb)
            loss = F.cross_entropy(logits, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.shape[0]

        with torch.no_grad():
            test_preds = model(test_x).argmax(dim=1)
            test_acc = (test_preds == test_y).float().mean().item()
        print(
            f"epoch {epoch + 1}/{EPOCHS}: train_loss={total_loss / n_train:.4f} "
            f"test_acc={test_acc:.4f}"
        )

    CHECKPOINT_DIR.mkdir(exist_ok=True)
    torch.save(model.state_dict(), CHECKPOINT_PATH)
    print(f"saved float checkpoint to {CHECKPOINT_PATH}")


if __name__ == "__main__":
    main()
