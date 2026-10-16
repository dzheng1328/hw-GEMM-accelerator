import { loadModelInBrowser, openChipInBrowser } from "./browserAssets";
import { Engine, type EngineEvent, type RunRequest } from "./engine";

const engine = new Engine({ openChip: openChipInBrowser, loadModel: loadModelInBrowser }, (event: EngineEvent, transfer = []) =>
  self.postMessage(event, { transfer }),
);

self.onmessage = (message: MessageEvent<RunRequest>) => {
  void engine.run(message.data);
};
