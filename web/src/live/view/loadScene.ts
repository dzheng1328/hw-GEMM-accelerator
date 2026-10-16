import type { ComponentType } from "react";
import type { MeshSceneProps } from "./MeshScene";

export type SceneComponent = ComponentType<MeshSceneProps>;

/** The scene and three.js live in their own chunk; nothing else imports MeshScene (type imports are erased). */
export async function loadScene(): Promise<SceneComponent> {
  return (await import("./MeshScene")).default;
}
