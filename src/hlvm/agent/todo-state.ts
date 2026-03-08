export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoState {
  items: TodoItem[];
}

export function createTodoState(items: TodoItem[] = []): TodoState {
  return { items: cloneTodoItems(items) };
}

export function cloneTodoItems(items: TodoItem[]): TodoItem[] {
  return items.map((item) => ({ ...item }));
}

export function cloneTodoState(state: TodoState): TodoState {
  return createTodoState(state.items);
}

export function createTodoStateFromPlan(
  steps: Array<{ id: string; title: string }>,
  completedIds: Iterable<string> = [],
  currentIndex?: number,
): TodoState {
  const done = new Set(completedIds);
  return createTodoState(
    steps.map((step, index) => ({
      id: step.id,
      content: step.title,
      status: done.has(step.id)
        ? "completed"
        : (currentIndex !== undefined && index === currentIndex)
        ? "in_progress"
        : "pending",
    })),
  );
}

export function isTodoStateDerivedFromPlan(
  items: TodoItem[],
  steps: Array<{ id: string; title: string }>,
  completedIds: Iterable<string> = [],
): boolean {
  const completed = [...completedIds];
  const currentIndex = completed.length < steps.length
    ? completed.length
    : undefined;
  const derived = createTodoStateFromPlan(steps, completed, currentIndex).items;
  return items.length === derived.length &&
    items.every((item, index) => {
      const expected = derived[index];
      return !!expected &&
        item.id === expected.id &&
        item.content === expected.content &&
        item.status === expected.status;
    });
}

export function summarizeTodoState(state: TodoState): string {
  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
  };
  for (const item of state.items) {
    counts[item.status] += 1;
  }

  const total = state.items.length;
  const parts: string[] = [`${total} todo${total === 1 ? "" : "s"}`];
  if (counts.completed > 0) {
    parts.push(`${counts.completed} done`);
  }
  if (counts.in_progress > 0) {
    parts.push(`${counts.in_progress} in progress`);
  }
  if (counts.pending > 0) {
    parts.push(`${counts.pending} pending`);
  }
  return parts.join(" · ");
}
