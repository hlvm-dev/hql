import type { LayoutNode } from './node.ts'
import { createYogaLayoutNode } from './yoga.ts'

export function createLayoutNode(): LayoutNode {
  return createYogaLayoutNode()
}
