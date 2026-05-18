// src/verdigraph/evaluation.ts — TS port of verdigraph/evaluation.py.

export interface EvaluationResult {
  task_id: string;
  task_type: string;
  success_score: number;
  accuracy: number;
  user_satisfaction: number;
  cost_efficiency: number;
  safety_score: number;
  notes: string;
  used_edges: Array<[string, string]>;
  used_nodes: string[];
}

const inUnitRange = (name: string, v: number) => {
  if (!(v >= 0 && v <= 1)) throw new Error(`${name} must be in [0, 1] (got ${v})`);
};

export function makeEvaluationResult(input: Partial<EvaluationResult> & { task_id: string; task_type: string; success_score: number }): EvaluationResult {
  const r: EvaluationResult = {
    task_id:           input.task_id,
    task_type:         input.task_type,
    success_score:     input.success_score,
    accuracy:          input.accuracy          ?? 0,
    user_satisfaction: input.user_satisfaction ?? 0,
    cost_efficiency:   input.cost_efficiency   ?? 0,
    safety_score:      input.safety_score      ?? 1,
    notes:             input.notes             ?? "",
    used_edges:        input.used_edges        ?? [],
    used_nodes:        input.used_nodes        ?? [],
  };
  inUnitRange("success_score", r.success_score);
  inUnitRange("accuracy", r.accuracy);
  inUnitRange("user_satisfaction", r.user_satisfaction);
  inUnitRange("cost_efficiency", r.cost_efficiency);
  inUnitRange("safety_score", r.safety_score);
  return r;
}

export function isSuccess(r: EvaluationResult): boolean {
  return r.success_score >= 0.65 && r.safety_score >= 0.8;
}

export function isFailure(r: EvaluationResult): boolean {
  return r.success_score < 0.4 || r.safety_score < 0.6;
}
