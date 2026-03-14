/**
 * useStateAndRef — Synchronized state + ref for streaming callbacks.
 *
 * Solves the stale closure problem: callbacks capture the ref (always current),
 * while React re-renders from the state. The ref is synced on every render.
 */

import { type Dispatch, type MutableRefObject, type SetStateAction, useRef, useState } from "react";

export function useStateAndRef<T>(
  initial: T,
): [T, MutableRefObject<T>, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(initial);
  const ref = useRef(state);
  ref.current = state;
  return [state, ref, setState];
}
