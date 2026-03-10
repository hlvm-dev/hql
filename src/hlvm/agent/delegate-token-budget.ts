export interface DelegateTokenBudget {
  maxTokens: number;
  consumed: number;
  exceeded: boolean;
}

export function createDelegateTokenBudget(max: number): DelegateTokenBudget {
  return { maxTokens: max, consumed: 0, exceeded: false };
}

export function recordBudgetUsage(budget: DelegateTokenBudget, tokens: number): boolean {
  budget.consumed += tokens;
  if (budget.consumed >= budget.maxTokens) {
    budget.exceeded = true;
  }
  return budget.exceeded;
}
