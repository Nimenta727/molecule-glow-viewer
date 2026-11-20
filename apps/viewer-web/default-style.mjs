import { resolveMechanism } from '../../plugins/mechanism-catalog.mjs';
import { ADK_PLAYER } from '../../plugins/adenylate-kinase/index.mjs';

// Which structure representation a scene opens with when it does not store one. The classic default is flat colour
// domains with ink outlines ("blob"). Scenes that declare functional domains (legacy `core` rules) and the adenylate
// kinase open/closed pair open in the functional-domain view, which is how the classic viewer showed them: smooth
// domain lobes that make the hinge motion readable.
export function defaultStyleFor(scene) {
  if (Array.isArray(scene?.legacy?.scene?.core) && scene.legacy.scene.core.length) return 'functional';
  return scene && resolveMechanism(scene) === ADK_PLAYER ? 'functional' : 'blob';
}
