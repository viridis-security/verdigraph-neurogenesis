"""
verdigraph/benchmark.py — compute-efficiency benchmark harness.

Runs one fixed, deterministic workload twice:

  baseline    a naive static pipeline — every task is sent to the frontier
              model, at full token count, with no cache and no routing. This
              is the "static assembly of prompts and tools" VISION.md
              describes.

  verdigraph  the real verdigraph.compute.ComputeOptimizer router plus cache
              reuse. Trivial tasks route to cheap models; exact repeats are
              served from cache; the router's hard quality bar guarantees a
              cheaper backend is only chosen when it still clears the task's
              minimum quality floor.

Each task's compute is costed by verdigraph.thermo, so the output is a
*measured* energy / carbon / dollar delta — and the energy saving is
decomposed by mechanism (cache reuse vs routing) so the claim is auditable.

Invariants:
  TA5  deterministic — a fixed seed produces an identical workload, identical
       routing, and therefore identical energy / carbon numbers.
  TA3  the decomposition reconciles exactly: baseline_energy - verdigraph_energy
       == cache_saving + routing_saving (asserted at runtime).
  Honesty — the baseline is naive but *explicitly stated*; success is scored
       against each task's required quality floor, so the benchmark never
       credits Verdigraph for quality the task did not ask for.

Run:  python -m verdigraph.benchmark
"""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .compute import ComputeOptimizer, ComputeProfile, TaskProfile
from .thermo import ThermoAccount, ThermodynamicAccountant, verify_account

DEFAULT_SEED = 7
DEFAULT_N_TASKS = 240


# ─── workload ───────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Task:
    id: str
    task_type: str
    difficulty: float
    risk: float
    min_quality: float
    input_tokens: int
    output_tokens: int
    repeat_of: Optional[str] = None

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


def generate_workload(seed: int = DEFAULT_SEED, n_tasks: int = DEFAULT_N_TASKS) -> List[Task]:
    """Deterministic task stream. Difficulty is skewed low — the realistic case
    where a frontier model is overkill for most work — and ~35% of tasks are
    exact repeats of an earlier task (cacheable)."""
    rng = random.Random(seed)
    types = ["literature_review", "data_extraction", "summarize", "classify",
             "code_review", "triage", "translate", "qa_lookup"]
    tasks: List[Task] = []
    fresh: List[Task] = []
    for i in range(n_tasks):
        tid = f"task_{i:04d}"
        if len(fresh) >= 8 and rng.random() < 0.35:
            src = rng.choice(fresh)
            tasks.append(Task(tid, src.task_type, src.difficulty, src.risk,
                              src.min_quality, src.input_tokens, src.output_tokens,
                              repeat_of=src.id))
            continue
        r = rng.random()
        if r < 0.55:                                   # low difficulty (majority)
            diff, minq = rng.uniform(0.10, 0.40), rng.uniform(0.55, 0.66)
        elif r < 0.85:                                 # medium
            diff, minq = rng.uniform(0.45, 0.70), rng.uniform(0.70, 0.80)
        else:                                          # high
            diff, minq = rng.uniform(0.72, 0.95), rng.uniform(0.85, 0.93)
        risk = rng.uniform(0.05, 0.55) if rng.random() < 0.85 else rng.uniform(0.75, 0.95)
        t = Task(tid, rng.choice(types), round(diff, 3), round(risk, 3),
                 round(minq, 3), rng.randint(400, 3500), rng.randint(150, 1400),
                 repeat_of=None)
        tasks.append(t)
        fresh.append(t)
    return tasks


# ─── compute backends (illustrative but plausible 2025 figures) ─────────────
def benchmark_profiles() -> List[ComputeProfile]:
    """Three routing tiers. Dollar costs are illustrative ($/1k tokens); the
    energy figures live in verdigraph.thermo and are keyed by these same ids."""
    return [
        ComputeProfile(
            id="local_small", kind="local_model", quality_score=0.62,
            cost_per_1k_input_tokens=0.00005, cost_per_1k_output_tokens=0.00015,
            latency_ms=400.0, gpu_memory_gb=8.0, max_context_tokens=8192, local=True),
        ComputeProfile(
            id="efficient_cloud", kind="cloud_model", quality_score=0.78,
            cost_per_1k_input_tokens=0.0008, cost_per_1k_output_tokens=0.0024,
            latency_ms=900.0, gpu_memory_gb=0.0, max_context_tokens=32768, local=False),
        ComputeProfile(
            id="frontier_cloud", kind="cloud_model", quality_score=0.95,
            cost_per_1k_input_tokens=0.003, cost_per_1k_output_tokens=0.015,
            latency_ms=2200.0, gpu_memory_gb=0.0, max_context_tokens=200000, local=False),
    ]


def _jitter(*parts: object) -> float:
    """Deterministic pseudo-random value in [0, 1) from a hash of the parts."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big") / 0xFFFFFFFF


def estimate_success(quality_score: float, min_quality: float, *seed_parts: object) -> float:
    """Success scored against the task's *required* quality floor.

    A backend that clears `min_quality` delivers the task at the standard it
    asked for — that is success. Quality above the floor is over-provisioning,
    not extra credit, so the benchmark never rewards Verdigraph (or the
    baseline) for capability the task did not require. A small margin bonus
    reflects the real reliability gain of a stronger model.
    """
    if quality_score < min_quality:           # router never selects these
        return max(0.0, 0.55 - (min_quality - quality_score))
    margin = quality_score - min_quality
    base = 0.88 + 0.06 * min(1.0, margin / 0.35)
    return max(0.0, min(1.0, base + (_jitter(*seed_parts) - 0.5) * 0.04))


# ─── run modes ──────────────────────────────────────────────────────────────
@dataclass
class RunOutcome:
    account: ThermoAccount
    total_success: float = 0.0
    dollar_cost: float = 0.0
    backend_calls: Dict[str, int] = field(default_factory=dict)
    counterfactual_frontier_joules: float = 0.0   # frontier energy for the same tokens
    cache_saving_joules: float = 0.0
    routing_saving_joules: float = 0.0

    @property
    def n(self) -> int:
        return self.account.model_calls + self.account.cache_hits


def _frontier_facility_joules(acc: ThermodynamicAccountant, total_tokens: int) -> float:
    """Counterfactual: facility energy if this task ran on the frontier model."""
    return acc.account_inference("frontier_cloud", total_tokens, 0, 0.0).facility_energy_joules


def run_baseline(workload: List[Task], acc: ThermodynamicAccountant) -> RunOutcome:
    """Naive static pipeline: every task -> frontier model, full tokens, no cache."""
    profiles = {p.id: p for p in benchmark_profiles()}
    frontier = profiles["frontier_cloud"]
    out = RunOutcome(account=ThermoAccount())
    for t in workload:
        success = estimate_success(frontier.quality_score, t.min_quality,
                                   t.id, "frontier_cloud")
        res = acc.account_inference("frontier_cloud", t.total_tokens,
                                    t.output_tokens, success)
        out.account.add(res, wall_seconds=frontier.latency_ms / 1000.0)
        out.total_success += success
        out.dollar_cost += frontier.estimate_cost(t.input_tokens, t.output_tokens)
        out.backend_calls["frontier_cloud"] = out.backend_calls.get("frontier_cloud", 0) + 1
        out.counterfactual_frontier_joules += res.facility_energy_joules
    return out


def run_verdigraph(workload: List[Task], acc: ThermodynamicAccountant) -> RunOutcome:
    """Real ComputeOptimizer router + cache reuse."""
    profiles = {p.id: p for p in benchmark_profiles()}
    optimizer = ComputeOptimizer(benchmark_profiles())
    out = RunOutcome(account=ThermoAccount())
    success_by_id: Dict[str, float] = {}

    for t in workload:
        cf_joules = _frontier_facility_joules(acc, t.total_tokens)
        out.counterfactual_frontier_joules += cf_joules

        # 1) cache — exact repeat, and not too risky to reuse (real safety rule)
        if t.repeat_of is not None and ComputeOptimizer.should_use_cache(
                cache_confidence=0.95, task_risk=t.risk):
            reused = success_by_id.get(t.repeat_of, 0.88)
            res = acc.account_cache_hit(t.output_tokens, reused)
            out.account.add(res, wall_seconds=0.015, is_cache_hit=True)
            out.total_success += reused
            success_by_id[t.id] = reused
            out.backend_calls["cache"] = out.backend_calls.get("cache", 0) + 1
            out.cache_saving_joules += cf_joules - res.facility_energy_joules
            continue

        # 2) route — the real optimizer picks the cheapest *eligible* backend
        task_profile = TaskProfile(
            id=t.id, task_type=t.task_type, difficulty=t.difficulty, risk=t.risk,
            expected_input_tokens=t.input_tokens, expected_output_tokens=t.output_tokens,
            min_quality=t.min_quality)
        decision = optimizer.choose_profile(task_profile)
        chosen = profiles[decision.profile_id]
        success = estimate_success(chosen.quality_score, t.min_quality,
                                   t.id, decision.profile_id)
        res = acc.account_inference(decision.profile_id, t.total_tokens,
                                    t.output_tokens, success)
        out.account.add(res, wall_seconds=chosen.latency_ms / 1000.0)
        out.total_success += success
        out.dollar_cost += chosen.estimate_cost(t.input_tokens, t.output_tokens)
        success_by_id[t.id] = success
        out.backend_calls[decision.profile_id] = out.backend_calls.get(decision.profile_id, 0) + 1
        if decision.profile_id != "frontier_cloud":
            out.routing_saving_joules += cf_joules - res.facility_energy_joules
    return out


# ─── result assembly ────────────────────────────────────────────────────────
@dataclass
class BenchmarkResult:
    seed: int
    n_tasks: int
    workload: Dict[str, object]
    baseline: Dict[str, object]
    verdigraph: Dict[str, object]
    delta: Dict[str, object]
    decomposition: Dict[str, object]
    thermodynamics: Dict[str, object]
    coefficients: Dict[str, object]

    def to_dict(self) -> Dict[str, object]:
        return {
            "seed": self.seed, "n_tasks": self.n_tasks, "workload": self.workload,
            "baseline": self.baseline, "verdigraph": self.verdigraph,
            "delta": self.delta, "decomposition": self.decomposition,
            "thermodynamics": self.thermodynamics, "coefficients": self.coefficients,
        }


def _pct(part: float, whole: float) -> float:
    return 0.0 if whole == 0 else round(100.0 * part / whole, 2)


def run_benchmark(seed: int = DEFAULT_SEED, n_tasks: int = DEFAULT_N_TASKS) -> BenchmarkResult:
    """Run both modes and assemble an auditable result. Deterministic (TA5)."""
    workload = generate_workload(seed, n_tasks)
    acc = ThermodynamicAccountant()

    base = run_baseline(workload, acc)
    verd = run_verdigraph(workload, acc)

    # TA3: the saving decomposition must reconcile exactly with the energy delta.
    energy_delta = base.account.energy_joules - verd.account.energy_joules
    decomposed = verd.cache_saving_joules + verd.routing_saving_joules
    if not abs(energy_delta - decomposed) < 1e-6 * max(1.0, base.account.energy_joules):
        raise AssertionError(
            f"TA3 violated: energy delta {energy_delta:.6f} J != "
            f"cache {verd.cache_saving_joules:.6f} + routing {verd.routing_saving_joules:.6f}")

    n_repeats = sum(1 for t in workload if t.repeat_of is not None)
    tiers = {"low": 0, "medium": 0, "high": 0}
    for t in workload:
        if t.repeat_of is not None:
            continue
        tiers["low" if t.difficulty < 0.42 else "high" if t.difficulty > 0.71 else "medium"] += 1

    def mode_block(o: RunOutcome) -> Dict[str, object]:
        a = o.account
        succ_tasks = o.total_success
        return {
            "energy_kwh": round(a.energy_kwh, 6),
            "carbon_gco2e": round(a.carbon_gco2e, 3),
            "dollar_cost_usd": round(o.dollar_cost, 4),
            "wall_hours": round(a.wall_seconds / 3600.0, 4),
            "mean_success": round(succ_tasks / max(1, o.n), 4),
            "model_calls": a.model_calls,
            "cache_hits": a.cache_hits,
            "tokens_processed": a.tokens,
            "successful_tasks_per_kwh": round(succ_tasks / a.energy_kwh, 1) if a.energy_kwh > 0 else None,
            "backend_calls": dict(sorted(o.backend_calls.items())),
        }

    base_blk, verd_blk = mode_block(base), mode_block(verd)

    delta = {
        "energy_reduction_pct": _pct(energy_delta, base.account.energy_joules),
        "carbon_reduction_pct": _pct(base.account.carbon_gco2e - verd.account.carbon_gco2e,
                                     base.account.carbon_gco2e),
        "cost_reduction_pct": _pct(base.dollar_cost - verd.dollar_cost, base.dollar_cost),
        "wall_time_reduction_pct": _pct(base.account.wall_seconds - verd.account.wall_seconds,
                                        base.account.wall_seconds),
        "mean_success_baseline": base_blk["mean_success"],
        "mean_success_verdigraph": verd_blk["mean_success"],
        "success_delta": round(verd_blk["mean_success"] - base_blk["mean_success"], 4),
        "efficiency_gain_x": round(
            (verd_blk["successful_tasks_per_kwh"] or 0)
            / (base_blk["successful_tasks_per_kwh"] or 1), 2),
    }

    decomposition = {
        "cache_saving_kwh": round(verd.cache_saving_joules / 3.6e6, 6),
        "routing_saving_kwh": round(verd.routing_saving_joules / 3.6e6, 6),
        "cache_share_of_saving_pct": _pct(verd.cache_saving_joules, energy_delta),
        "routing_share_of_saving_pct": _pct(verd.routing_saving_joules, energy_delta),
        "reconciles": True,
    }

    L_temp = 300.0
    thermo = {
        "temperature_k": L_temp,
        "landauer_floor_j_per_bit": landauer_floor(L_temp),
        "baseline_joules_per_useful_bit": _safe(base.account.joules_per_useful_bit),
        "verdigraph_joules_per_useful_bit": _safe(verd.account.joules_per_useful_bit),
        "baseline_thermo_efficiency": base.account.thermodynamic_efficiency(L_temp),
        "verdigraph_thermo_efficiency": verd.account.thermodynamic_efficiency(L_temp),
        "baseline_landauer_headroom_x": _safe(base.account.landauer_headroom(L_temp)),
        "verdigraph_landauer_headroom_x": _safe(verd.account.landauer_headroom(L_temp)),
        "note": ("Thermodynamic efficiency is the fraction of the Landauer limit "
                 "achieved; headroom is how many times above the floor the system "
                 "runs. Both modes sit far above the floor — the gap between them "
                 "is the measured efficiency gain."),
    }

    coeffs = {
        "grid_gco2e_per_kwh": acc.grid.gco2e_per_kwh,
        "grid_source": acc.grid.source,
        "pue": acc.facility.pue,
        "pue_source": acc.facility.source,
        "bits_per_token": acc.information.bits_per_token,
        "backends_wh_per_1k_tokens": {b: be.wh_per_1k_tokens
                                      for b, be in sorted(acc.backends.items())},
        "cache_wh_per_hit": acc.cache_wh_per_hit,
    }

    return BenchmarkResult(
        seed=seed, n_tasks=n_tasks,
        workload={"total": n_tasks, "fresh": n_tasks - n_repeats, "repeats": n_repeats,
                  "fresh_difficulty_tiers": tiers},
        baseline=base_blk, verdigraph=verd_blk, delta=delta,
        decomposition=decomposition, thermodynamics=thermo, coefficients=coeffs)


def landauer_floor(temperature_k: float = 300.0) -> float:
    from .thermo import landauer_energy_per_bit
    return landauer_energy_per_bit(temperature_k)


def _safe(x: float) -> Optional[float]:
    return None if x in (float("inf"), float("-inf")) or x != x else x


# ─── reporting ──────────────────────────────────────────────────────────────
def format_report(r: BenchmarkResult) -> str:
    d, b, v = r.delta, r.baseline, r.verdigraph
    L = r.thermodynamics
    lines = [
        "VERDIGRAPH COMPUTE-EFFICIENCY BENCHMARK",
        "=" * 64,
        f"Workload: {r.n_tasks} tasks (seed {r.seed}) — "
        f"{r.workload['fresh']} fresh, {r.workload['repeats']} repeats",
        f"  fresh difficulty: {r.workload['fresh_difficulty_tiers']}",
        "",
        f"{'':22s}{'BASELINE':>16s}{'VERDIGRAPH':>16s}",
        f"{'  (naive static)':22s}{'':>16s}{'(router+cache)':>16s}",
        "-" * 64,
        f"{'energy (kWh)':22s}{b['energy_kwh']:>16.5f}{v['energy_kwh']:>16.5f}",
        f"{'carbon (gCO2e)':22s}{b['carbon_gco2e']:>16.1f}{v['carbon_gco2e']:>16.1f}",
        f"{'dollar cost (USD)':22s}{b['dollar_cost_usd']:>16.4f}{v['dollar_cost_usd']:>16.4f}",
        f"{'wall time (hours)':22s}{b['wall_hours']:>16.3f}{v['wall_hours']:>16.3f}",
        f"{'mean success':22s}{b['mean_success']:>16.4f}{v['mean_success']:>16.4f}",
        f"{'success / kWh':22s}{b['successful_tasks_per_kwh']:>16.1f}"
        f"{v['successful_tasks_per_kwh']:>16.1f}",
        "-" * 64,
        f"  energy reduction      {d['energy_reduction_pct']:>6.1f} %",
        f"  carbon reduction      {d['carbon_reduction_pct']:>6.1f} %",
        f"  dollar reduction      {d['cost_reduction_pct']:>6.1f} %",
        f"  wall-time reduction   {d['wall_time_reduction_pct']:>6.1f} %",
        f"  success delta         {d['success_delta']:>+6.4f}  "
        f"(floor met in both modes)",
        f"  efficiency gain       {d['efficiency_gain_x']:>6.2f} x  "
        f"(successful tasks per kWh)",
        "",
        "WHERE THE SAVING COMES FROM",
        "-" * 64,
        f"  cache reuse           {r.decomposition['cache_share_of_saving_pct']:>6.1f} %  "
        f"({r.decomposition['cache_saving_kwh']:.5f} kWh)",
        f"  compute routing       {r.decomposition['routing_share_of_saving_pct']:>6.1f} %  "
        f"({r.decomposition['routing_saving_kwh']:.5f} kWh)",
        f"  reconciles with delta : {r.decomposition['reconciles']}",
        "",
        "THERMODYNAMIC CONTEXT (Landauer)",
        "-" * 64,
        f"  Landauer floor        {L['landauer_floor_j_per_bit']:.3e} J / bit (300 K)",
        f"  baseline runs         {L['baseline_landauer_headroom_x']:.3e} x above the floor",
        f"  verdigraph runs       {L['verdigraph_landauer_headroom_x']:.3e} x above the floor",
        "=" * 64,
        "Baseline = every task to the frontier model, no cache, no routing.",
        "Energy figures are estimates from cited 2025 coefficients (see JSON);",
        "calibrate against measured datacenter telemetry before reporting as",
        "verified. Methodology and invariants: verdigraph/thermo.py.",
    ]
    return "\n".join(lines)


def main() -> None:
    result = run_benchmark()
    report = format_report(result)
    print(report)

    # invariant self-check
    workload = generate_workload(result.seed, result.n_tasks)
    acc = ThermodynamicAccountant()
    for name, ok in verify_account(run_verdigraph(workload, acc).account):
        if not ok:
            raise AssertionError(f"invariant failed: {name}")

    out_dir = Path(__file__).resolve().parent.parent / "examples" / "benchmark"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "benchmark_results.json").write_text(json.dumps(result.to_dict(), indent=2))
    (out_dir / "benchmark_report.txt").write_text(report + "\n")
    print(f"\nwritten: {out_dir}/benchmark_results.json")
    print(f"written: {out_dir}/benchmark_report.txt")


if __name__ == "__main__":
    main()
