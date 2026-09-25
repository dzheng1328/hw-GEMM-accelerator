"""Train the float CIFAR-10 network (spec section 1). Random-crop and flip
augmentation, SGD with Nesterov momentum and a one-cycle schedule, on MPS
when available. Writes model/checkpoints/cifar_float.pt (gitignored)."""

from pathlib import Path

import torch
import torch.nn.functional as F

from cifar_data import load_cifar10
from cifar_net import CifarNet, to_input

CHECKPOINT_PATH = Path(__file__).parent / "checkpoints" / "cifar_float.pt"
EPOCHS = 40
BATCH_SIZE = 128
PEAK_LR = 0.1
WEIGHT_DECAY = 5e-4
SEED = 0


def augment(x):
    """Per-sample random 32x32 crop of the 4-pixel zero-padded image (zero
    is mid-gray after to_input) and a random horizontal flip."""
    n, dev = x.shape[0], x.device
    xp = F.pad(x, (4, 4, 4, 4))
    oy = torch.randint(0, 9, (n,), device=dev)
    ox = torch.randint(0, 9, (n,), device=dev)
    ar = torch.arange(32, device=dev)
    rows = (oy[:, None] + ar)[:, None, :, None]
    cols = (ox[:, None] + ar)[:, None, None, :]
    out = xp[torch.arange(n, device=dev)[:, None, None, None], torch.arange(3, device=dev)[None, :, None, None], rows, cols]
    flip = torch.rand(n, device=dev) < 0.5
    out[flip] = out[flip].flip(3)
    return out


@torch.no_grad()
def evaluate(model, images_uint8, labels, device) -> float:
    model.eval()
    correct = 0
    for i in range(0, len(images_uint8), 1000):
        logits = model(to_input(images_uint8[i : i + 1000]).to(device))
        correct += (logits.argmax(1).cpu().numpy() == labels[i : i + 1000]).sum()
    return correct / len(images_uint8)


def main():
    torch.manual_seed(SEED)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    train_x, train_y, test_x, test_y = load_cifar10()
    xs = to_input(train_x).to(device)
    ys = torch.from_numpy(train_y.astype("int64")).to(device)

    model = CifarNet().to(device)
    opt = torch.optim.SGD(model.parameters(), lr=PEAK_LR, momentum=0.9, nesterov=True, weight_decay=WEIGHT_DECAY)
    steps = EPOCHS * ((len(xs) + BATCH_SIZE - 1) // BATCH_SIZE)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=PEAK_LR, total_steps=steps)
    for epoch in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(xs), device=device)
        for i in range(0, len(xs), BATCH_SIZE):
            idx = perm[i : i + BATCH_SIZE]
            loss = F.cross_entropy(model(augment(xs[idx])), ys[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        acc = evaluate(model, test_x, test_y, device)
        print(f"epoch {epoch + 1}/{EPOCHS}: loss={loss.item():.3f} test_acc={acc:.4f}", flush=True)

    CHECKPOINT_PATH.parent.mkdir(exist_ok=True)
    torch.save(model.cpu().state_dict(), CHECKPOINT_PATH)
    print(f"saved {CHECKPOINT_PATH}; final float test accuracy {acc:.4f}")


if __name__ == "__main__":
    main()
