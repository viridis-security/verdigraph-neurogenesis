from verdigraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile, EfficiencyReport


def test_choose_profile_prefers_cheap_sufficient_local_model_for_easy_task():
    optimizer = ComputeOptimizer([
        ComputeProfile(id="local_small", kind="local_model", quality_score=0.70, latency_ms=300, gpu_memory_gb=2, local=True),
        ComputeProfile(id="cloud_large", kind="api_model", quality_score=0.95, cost_per_1k_input_tokens=0.01, cost_per_1k_output_tokens=0.03, latency_ms=1800),
    ])
    task = TaskProfile(id="t1", task_type="classification", difficulty=0.25, risk=0.15, min_quality=0.60)
    decision = optimizer.choose_profile(task)
    assert decision.profile_id == "local_small"


def test_choose_profile_can_satisfy_local_requirement():
    optimizer = ComputeOptimizer([
        ComputeProfile(id="local_medium", kind="local_model", quality_score=0.82, latency_ms=800, gpu_memory_gb=8, local=True),
        ComputeProfile(id="cloud_large", kind="api_model", quality_score=0.95, latency_ms=1800, local=False),
    ])
    task = TaskProfile(id="t2", task_type="private_summary", requires_local=True, min_quality=0.75)
    decision = optimizer.choose_profile(task)
    assert decision.profile_id == "local_medium"


def test_cache_and_escalation_policies():
    assert ComputeOptimizer.should_use_cache(cache_confidence=0.92, task_risk=0.2)
    assert not ComputeOptimizer.should_use_cache(cache_confidence=0.92, task_risk=0.8)
    assert ComputeOptimizer.should_escalate(current_confidence=0.5, task_risk=0.7)
    assert not ComputeOptimizer.should_escalate(current_confidence=0.95, task_risk=0.7)


def test_efficiency_report_positive_metric():
    report = EfficiencyReport(task_success=0.8, total_estimated_cost=0.02, total_latency_ms=2000, total_gpu_memory_gb=4, model_calls=2)
    assert report.cognitive_efficiency > 0


def test_min_quality_is_hard_filter():
    """A profile below the task's min_quality must be rejected outright,
    even when it is dramatically cheaper. Preserves invariant 11 without
    silently regressing task quality."""
    import pytest

    optimizer = ComputeOptimizer([
        ComputeProfile(id="too_weak_cache", kind="cache", quality_score=0.50, latency_ms=10, local=True),
        ComputeProfile(id="weak_local", kind="local_model", quality_score=0.55, latency_ms=200, local=True),
    ])
    task = TaskProfile(id="t", task_type="risky", min_quality=0.80)
    with pytest.raises(ValueError, match="No compute profile satisfies"):
        optimizer.choose_profile(task)


def test_min_quality_filter_prefers_sufficient_profile_over_cheap_one():
    optimizer = ComputeOptimizer([
        ComputeProfile(id="cheap_low_quality", kind="cache", quality_score=0.65, latency_ms=10, local=True),
        ComputeProfile(id="adequate", kind="local_model", quality_score=0.80, latency_ms=500, local=True),
    ])
    task = TaskProfile(id="t", task_type="task", min_quality=0.75, requires_local=True)
    decision = optimizer.choose_profile(task)
    assert decision.profile_id == "adequate"
