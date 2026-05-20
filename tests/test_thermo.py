"""
tests/test_thermo.py — invariant tests for the thermodynamic accounting layer.

Each test maps to a build invariant:
  TA2  explicit units / exact conversions
  TA3  additive & non-negative accounting
  TA4  Landauer is a hard floor; thermodynamic efficiency in [0, 1]
  TA5  benchmark determinism
  plus methodology-honesty (TA1) and consistency checks.
"""
import math

import pytest

from verdigraph.thermo import (
    BOLTZMANN_J_PER_K, JOULES_PER_KWH, JOULES_PER_WH,
    FacilityModel, GridModel, InformationModel, ThermoAccount,
    ThermodynamicAccountant, info_rate_ceiling, landauer_energy_per_bit,
    verify_account,
)
from verdigraph.benchmark import run_benchmark, generate_workload


# ── Landauer's principle ────────────────────────────────────────────────────
def test_landauer_floor_value():
    """E_min = kB * T * ln 2 ≈ 2.871e-21 J at 300 K."""
    e = landauer_energy_per_bit(300.0)
    assert math.isclose(e, BOLTZMANN_J_PER_K * 300.0 * math.log(2), rel_tol=1e-12)
    assert math.isclose(e, 2.8709e-21, rel_tol=1e-3)


def test_landauer_scales_with_temperature():
    assert landauer_energy_per_bit(600.0) == pytest.approx(2 * landauer_energy_per_bit(300.0))


def test_landauer_rejects_nonpositive_temperature():
    with pytest.raises(ValueError):
        landauer_energy_per_bit(0.0)
    with pytest.raises(ValueError):
        landauer_energy_per_bit(-10.0)


def test_info_rate_ceiling_units():
    """P / (kB T ln2) gives bits/second; D must lie in (0, 1]."""
    ceiling = info_rate_ceiling(power_watts=100.0, temperature_k=300.0, dissipation_factor=1.0)
    assert ceiling == pytest.approx(100.0 / landauer_energy_per_bit(300.0))
    with pytest.raises(ValueError):
        info_rate_ceiling(100.0, dissipation_factor=0.0)
    with pytest.raises(ValueError):
        info_rate_ceiling(100.0, dissipation_factor=1.5)


# ── TA2: explicit units / exact conversions ─────────────────────────────────
def test_unit_conversions_exact():
    assert JOULES_PER_WH == 3600.0
    assert JOULES_PER_KWH == 3_600_000.0
    assert JOULES_PER_KWH == 1000.0 * JOULES_PER_WH


def test_grid_carbon_known_value():
    """1 kWh at 445 gCO2e/kWh must yield exactly 445 gCO2e."""
    grid = GridModel()
    assert grid.gco2e_per_kwh == 445.0
    assert grid.carbon_gco2e(JOULES_PER_KWH) == pytest.approx(445.0)
    assert grid.carbon_gco2e(0.0) == 0.0


def test_facility_pue_rejects_sub_unity():
    with pytest.raises(ValueError):
        FacilityModel(pue=0.9)  # facility energy can never be below IT energy


# ── TA3: additive, non-negative accounting ──────────────────────────────────
def test_account_inference_nonnegative_and_monotone():
    acc = ThermodynamicAccountant()
    small = acc.account_inference("frontier_cloud", 1000, 500, 0.9)
    large = acc.account_inference("frontier_cloud", 4000, 500, 0.9)
    assert small.facility_energy_joules >= 0.0
    assert small.carbon_gco2e >= 0.0
    # more tokens -> at least as much energy
    assert large.facility_energy_joules >= small.facility_energy_joules
    # facility energy includes PUE overhead
    assert large.facility_energy_joules == pytest.approx(
        large.it_energy_joules * acc.facility.pue)


def test_account_is_additive():
    """The total of an Account equals the sum of the results fed in (TA3)."""
    acc = ThermodynamicAccountant()
    r1 = acc.account_inference("frontier_cloud", 2000, 800, 0.9)
    r2 = acc.account_inference("local_small", 1500, 400, 0.85)
    total = ThermoAccount()
    total.add(r1, wall_seconds=2.2)
    total.add(r2, wall_seconds=0.4)
    assert total.energy_joules == pytest.approx(
        r1.facility_energy_joules + r2.facility_energy_joules)
    assert total.carbon_gco2e == pytest.approx(r1.carbon_gco2e + r2.carbon_gco2e)
    assert total.useful_bits == pytest.approx(r1.useful_bits + r2.useful_bits)
    assert total.model_calls == 2 and total.cache_hits == 0


def test_unknown_backend_rejected():
    acc = ThermodynamicAccountant()
    with pytest.raises(KeyError):
        acc.account_inference("imaginary_backend", 1000, 500, 0.9)


def test_negative_tokens_rejected():
    acc = ThermodynamicAccountant()
    with pytest.raises(ValueError):
        acc.account_inference("frontier_cloud", -1, 0, 0.9)


# ── TA1: information proxy behaves honestly ──────────────────────────────────
def test_useful_bits_proxy():
    info = InformationModel(bits_per_token=10.0)
    assert info.useful_bits(100, 1.0) == pytest.approx(1000.0)
    # a failed task produces no useful information
    assert info.useful_bits(100, 0.0) == 0.0
    # success score is clamped to [0, 1]
    assert info.useful_bits(100, 5.0) == pytest.approx(1000.0)
    # scales linearly with output tokens
    assert info.useful_bits(200, 0.5) == pytest.approx(2 * info.useful_bits(100, 0.5))


# ── TA4: Landauer is a hard floor ───────────────────────────────────────────
def _populated_account():
    acc = ThermodynamicAccountant()
    total = ThermoAccount()
    for tokens, out, succ, wall in [(2000, 800, 0.9, 2.2), (1200, 400, 0.8, 0.9)]:
        total.add(acc.account_inference("frontier_cloud", tokens, out, succ), wall_seconds=wall)
    return total


def test_thermodynamic_efficiency_in_range():
    acc = _populated_account()
    eff = acc.thermodynamic_efficiency(300.0)
    assert 0.0 <= eff <= 1.0


def test_energy_per_bit_never_below_landauer_floor():
    acc = _populated_account()
    assert acc.joules_per_useful_bit >= landauer_energy_per_bit(300.0)


def test_landauer_ratio_equals_efficiency_at_D1():
    """Per-bit and per-rate formulations are the same physics by two routes."""
    acc = _populated_account()
    assert acc.landauer_ratio(300.0, 1.0) == pytest.approx(
        acc.thermodynamic_efficiency(300.0), rel=1e-9)


def test_empty_account_efficiency_is_zero():
    assert ThermoAccount().thermodynamic_efficiency(300.0) == 0.0


def test_verify_account_all_pass():
    for name, ok in verify_account(_populated_account()):
        assert ok, f"invariant failed: {name}"


# ── TA5: benchmark determinism + reconciliation ─────────────────────────────
def test_benchmark_is_deterministic():
    a = run_benchmark(seed=7, n_tasks=180)
    b = run_benchmark(seed=7, n_tasks=180)
    assert a.to_dict() == b.to_dict()


def test_workload_generation_deterministic():
    w1 = generate_workload(seed=7, n_tasks=120)
    w2 = generate_workload(seed=7, n_tasks=120)
    assert w1 == w2
    # a different seed yields a different workload
    assert generate_workload(seed=8, n_tasks=120) != w1


def test_benchmark_reconciles_and_is_honest():
    """The energy delta must decompose exactly into cache + routing savings,
    Verdigraph must beat the baseline, and success must hold near the floor."""
    r = run_benchmark(seed=7, n_tasks=240)
    # reconciliation (run_benchmark raises if it fails; assert the flag too)
    assert r.decomposition["reconciles"] is True
    cache = r.decomposition["cache_share_of_saving_pct"]
    routing = r.decomposition["routing_share_of_saving_pct"]
    assert cache + routing == pytest.approx(100.0, abs=0.2)
    # Verdigraph uses strictly less energy and carbon
    assert r.verdigraph["energy_kwh"] < r.baseline["energy_kwh"]
    assert r.verdigraph["carbon_gco2e"] < r.baseline["carbon_gco2e"]
    assert r.delta["energy_reduction_pct"] > 0.0
    # success is not silently sacrificed — both modes clear the quality floor
    assert r.delta["mean_success_verdigraph"] > 0.80
    assert abs(r.delta["success_delta"]) < 0.12
    # efficiency (successful tasks per kWh) genuinely improves
    assert r.delta["efficiency_gain_x"] > 1.5
