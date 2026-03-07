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
  return { items: [...items] };
}
