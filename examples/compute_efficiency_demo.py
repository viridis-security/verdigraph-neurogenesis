"""Demonstrate Verdigraph's compute-efficiency routing layer.

Run from repo root:
    python examples/compute_efficiency_demo.py
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from verdigraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile


def main() -> None:
    optimizer = ComputeOptimizer([
        ComputeProfile(
            id="cache_reuse",
            kind="cache",
            quality_score=0.68,
            latency_ms=50,
            gpu_memory_gb=0,
            max_context_tokens=2048,
            local=True,
        ),
        ComputeProfile(
            id="local_3b_quantized",
            kind="local_model",
            quality_score=0.72,
            latency_ms=450,
            gpu_memory_gb=3.5,
            max_context_tokens=4096,
            local=True,
        ),
        ComputeProfile(
            id="local_14b_reasoner",
            kind="local_model",
            quality_score=0.84,
            latency_ms=1300,
            gpu_memory_gb=12.0,
            max_context_tokens=8192,
            local=True,
        ),
        ComputeProfile(
            id="cloud_high_assurance",
            kind="api_model",
            quality_score=0.95,
            cost_per_1k_input_tokens=0.005,
            cost_per_1k_output_tokens=0.015,
            latency_ms=2200,
            max_context_tokens=128000,
            local=False,
        ),
    ])

    tasks = [
        TaskProfile(id="task_easy", task_type="classification", difficulty=0.20, risk=0.10, min_quality=0.60),
        TaskProfile(id="task_private", task_type="private_summary", difficulty=0.45, risk=0.25, min_quality=0.70, requires_local=True),
        TaskProfile(id="task_hard", task_type="architecture_review", difficulty=0.85, risk=0.65, min_quality=0.90, expected_input_tokens=6000),
    ]

    for task in tasks:
        decision = optimizer.choose_profile(task)
        print(f"{task.id}: {decision.profile_id} | score={decision.score:.4f} | {decision.reason}")


if __name__ == "__main__":
    main()
