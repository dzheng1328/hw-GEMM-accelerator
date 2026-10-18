import { useCallback, useReducer, useRef, type MutableRefObject, type Reducer } from "react";

/**
 * `useReducer` that also keeps the state after every dispatched action in a ref, readable at once.
 * A handler that dispatches two actions in a row (select a mesh, then start a run) needs the token of the second one
 * to tag its result, and React's own state is only updated on the next render. The reducer must be pure.
 */
export function useSyncedReducer<S, A>(reducer: Reducer<S, A>, initial: S): [S, (action: A) => void, MutableRefObject<S>] {
  const [state, rawDispatch] = useReducer(reducer, initial);
  const latest = useRef(initial);
  const dispatch = useCallback(
    (action: A) => {
      latest.current = reducer(latest.current, action);
      rawDispatch(action);
    },
    [reducer],
  );
  return [state, dispatch, latest];
}
