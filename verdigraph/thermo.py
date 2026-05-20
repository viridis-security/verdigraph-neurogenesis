"""
verdigraph/thermo.py — thermodynamic accounting for Verdigraph.

Converts agent compute activity into estimated **energy** (joules), **carbon**
(gCO2e), and the **thermodynamic-efficiency** context set by Landauer's
principle. This is the layer that lets Verdigraph honour the VISION.md
commitment: "We will not claim carbon reductions we cannot verify against the
ledger."

Design invariants (see also docs / the build spec):

  TA1  Methodological honesty — every coefficient is a named, cited, overridable
       parameter. Estimates are labelled as estimates.
  TA2  Explicit units — joules internally; Wh/kWh/gCO2e at the surface;
       conversions are exact constants.
  TA3  Additive & non-negative — energy/carbon >= 0; a workload's total equals
       the sum of its tasks (an Account is a pure accumulator).
  TA4  Landauer is a hard floor — measured energy-per-useful-bit is always
       >= kB*T*ln2; thermodynamic efficiency lies in [0, 1].
  TA6  Non-invasive — this module *measures*; it never changes routing or
       growth. Energy-aware routing is a deliberate v2.

No external dependencies — stdlib only (consistent with verdigraph/brain.py).

----------------------------------------------------------------------------
Default coefficients and their sources (override per deployment):

  Grid carbon intensity   445 gCO2e/kWh
      Global average electricity carbon intensity, 2024 (IEA). Regional spread
      is large (clean grids <50, coal-heavy >700). Override per region.

  Datacenter PUE          1.56
      Uptime Institute Global Data Center Survey 2024 — industry average has
      held ~1.55-1.59 for six years. Hyperscale facilities reach ~1.1-1.2.

  Inference energy        frontier 0.30, efficient 0.08, local 0.02 Wh / 1k tok
      Anchored to 2025 per-query disclosures: a frontier text query consumes
      ~0.24-0.34 Wh (Google Gemini 0.24 Wh; OpenAI 0.34 Wh; Epoch AI optimised
      frontier median 0.31 Wh, IQR 0.16-0.60). Long-context / reasoning queries
      run substantially higher (~1-4 Wh). These are ESTIMATES, not telemetry —
      calibrate against measured datacenter power for verified figures.
----------------------------------------------------------------------------
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# ─── physical constants & exact unit conversions (TA2) ──────────────────────
BOLTZMANN_J_PER_K = 1.380649e-23   # exact, SI 2019 redefinition
LN2 = math.log(2.0)
JOULES_PER_WH = 3600.0
JOULES_PER_KWH = 3_600_000.0


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


# ─── Landauer's principle ───────────────────────────────────────────────────
def landauer_energy_per_bit(temperature_k: float = 300.0) -> float:
    """Minimum energy to irreversibly erase one bit: E_min = kB * T * ln 2.

    ~2.871e-21 J at T = 300 K. This is a hard physical floor: no logically
    irreversible computation can produce a bit of information below this cost
    (invariant TA4).
    """
    if temperature_k <= 0.0:
        raise ValueError("temperature_k must be a positive value in kelvin")
    return BOLTZMANN_J_PER_K * temperature_k * LN2


def info_rate_ceiling(
    power_watts: float,
    temperature_k: float = 300.0,
    dissipation_factor: float = 1.0,
) -> float:
    """Upper bound on information-production rate, in bits/second.

    Operationalises the Intelligence Bound inequality

        dI/dt  <=  P * D / (kB * T * ln 2)

    where P is dissipated power (W) and D is the dimensionless dissipation /
    availability factor (0 < D <= 1). D = 1.0 gives the absolute Landauer
    ceiling; set D from the Intelligence Bound paper for the realistic bound.
    """
    if power_watts < 0.0:
        raise ValueError("power_watts must be non-negative")
    if not 0.0 < dissipation_factor <= 1.0:
        raise ValueError("dissipation_factor D must lie in (0, 1]")
    return power_watts * dissipation_factor / landauer_energy_per_bit(temperature_k)


# ─── coefficient models (all cited, all overridable — TA1) ──────────────────
@dataclass(frozen=True)
class GridModel:
    """Electricity grid carbon intensity.

    Default: global average for 2024 (IEA), ~445 gCO2e/kWh. Override with the
    measured intensity of the region the compute actually runs in.
    """
    gco2e_per_kwh: float = 445.0
    source: str = "IEA global average electricity carbon intensity, 2024"

    def carbon_gco2e(self, energy_joules: float) -> float:
        return (energy_joules / JOULES_PER_KWH) * self.gco2e_per_kwh


@dataclass(frozen=True)
class FacilityModel:
    """Datacenter overhead. PUE scales IT energy up to facility energy.

    Default: 1.56 (Uptime Institute Global Data Center Survey 2024).
    """
    pue: float = 1.56
    source: str = "Uptime Institute Global Data Center Survey 2024"

    def __post_init__(self) -> None:
        if self.pue < 1.0:
            raise ValueError("PUE cannot be below 1.0 (facility >= IT energy)")


@dataclass(frozen=True)
class BackendEnergy:
    """Estimated inference energy for one compute backend.

    `wh_per_1k_tokens` is a blended per-1k-token estimate (input + output).
    These are ESTIMATES anchored to 2025 per-query disclosures, not telemetry
    (invariant TA1). The benchmark's headline ratio depends mainly on the
    *relative* spread between tiers and the workload mix — not on the absolute
    value — but absolute figures should still be calibrated before being
    reported as verified.
    """
    backend_id: str
    wh_per_1k_tokens: float
    note: str = ""

    def __post_init__(self) -> None:
        if self.wh_per_1k_tokens < 0.0:
            raise ValueError("wh_per_1k_tokens must be non-negative")


def default_backends() -> Dict[str, BackendEnergy]:
    """Default tiered energy estimates. See module docstring for sourcing."""
    return {
        "frontier_cloud": BackendEnergy(
            "frontier_cloud", 0.30,
            "Large frontier model. 2025 per-query disclosures 0.24-0.34 Wh; "
            "0.30 Wh/1k chosen as a conservative midpoint."),
        "efficient_cloud": BackendEnergy(
            "efficient_cloud", 0.08,
            "Smaller hosted model, ~4x more efficient per token than frontier."),
        "local_small": BackendEnergy(
            "local_small", 0.02,
            "Small on-premise / on-device model on a single GPU."),
    }


@dataclass(frozen=True)
class InformationModel:
    """Proxy for the useful information a task produces, in bits.

        useful_bits = output_tokens * bits_per_token * success_score

    `bits_per_token` is the genuine information density of model output. A
    natural-language token (~4 characters at ~1-1.5 bits/character of entropy)
    carries roughly 8-12 bits; 10 is the default midpoint.

    THIS IS A PROXY (invariant TA1). It is deliberately overridable: the
    principled measure of "useful information produced" belongs to the
    Intelligence Bound framework — substitute it here once formalised.
    """
    bits_per_token: float = 10.0
    source: str = "proxy: token ~4 chars at ~1-1.5 bits/char of language entropy"

    def useful_bits(self, output_tokens: float, success_score: float) -> float:
        if output_tokens < 0.0:
            raise ValueError("output_tokens must be non-negative")
        return output_tokens * self.bits_per_token * _clamp01(success_score)


# ─── the accountant ─────────────────────────────────────────────────────────
@dataclass
class EnergyCarbonResult:
    """One task's estimated thermodynamic cost. All fields carry explicit units."""
    backend_id: str
    tokens: int
    it_energy_joules: float       # compute energy only
    facility_energy_joules: float # compute energy * PUE
    carbon_gco2e: float
    useful_bits: float

    @property
    def facility_energy_wh(self) -> float:
        return self.facility_energy_joules / JOULES_PER_WH


@dataclass
class ThermoAccount:
    """Pure accumulator over a workload. Additive and non-negative (TA3).

    The total of an Account always equals the sum of the per-task results fed
    into it — there is no hidden state and no path that can decrease a total.
    """
    energy_joules: float = 0.0      # facility energy (includes PUE)
    carbon_gco2e: float = 0.0
    useful_bits: float = 0.0
    wall_seconds: float = 0.0
    tokens: int = 0
    model_calls: int = 0
    cache_hits: int = 0

    def add(self, result: EnergyCarbonResult, wall_seconds: float,
            is_cache_hit: bool = False) -> None:
        if wall_seconds < 0.0:
            raise ValueError("wall_seconds must be non-negative")
        self.energy_joules += result.facility_energy_joules
        self.carbon_gco2e += result.carbon_gco2e
        self.useful_bits += result.useful_bits
        self.wall_seconds += wall_seconds
        self.tokens += result.tokens
        if is_cache_hit:
            self.cache_hits += 1
        else:
            self.model_calls += 1

    # ── derived metrics ────────────────────────────────────────────────────
    @property
    def energy_kwh(self) -> float:
        return self.energy_joules / JOULES_PER_KWH

    @property
    def mean_power_watts(self) -> float:
        return self.energy_joules / self.wall_seconds if self.wall_seconds > 0 else 0.0

    @property
    def joules_per_useful_bit(self) -> float:
        return self.energy_joules / self.useful_bits if self.useful_bits > 0 else float("inf")

    def thermodynamic_efficiency(self, temperature_k: float = 300.0) -> float:
        """Fraction of the Landauer limit achieved: kB*T*ln2 / (J per useful bit).

        Lies in [0, 1] (invariant TA4). For any real digital system this is a
        tiny number — that *is* the finding: it quantifies the headroom between
        today's agents and the thermodynamic floor.
        """
        if self.useful_bits <= 0:
            return 0.0
        eff = landauer_energy_per_bit(temperature_k) / self.joules_per_useful_bit
        return _clamp01(eff)

    def landauer_headroom(self, temperature_k: float = 300.0) -> float:
        """How many times above the Landauer floor the workload runs (1 / efficiency)."""
        eff = self.thermodynamic_efficiency(temperature_k)
        return float("inf") if eff <= 0 else 1.0 / eff

    def info_rate_bits_per_s(self) -> float:
        return self.useful_bits / self.wall_seconds if self.wall_seconds > 0 else 0.0

    def landauer_ratio(self, temperature_k: float = 300.0,
                       dissipation_factor: float = 1.0) -> float:
        """Actual dI/dt as a fraction of the P*D/(kB*T*ln2) ceiling.

        Consistency note: with D = 1 this equals thermodynamic_efficiency() —
        the per-bit and per-rate formulations are the same physics by two
        routes. The test suite asserts they agree.
        """
        if self.wall_seconds <= 0 or self.useful_bits <= 0:
            return 0.0
        ceiling = info_rate_ceiling(self.mean_power_watts, temperature_k, dissipation_factor)
        return self.info_rate_bits_per_s() / ceiling if ceiling > 0 else 0.0


class ThermodynamicAccountant:
    """Turns compute activity into energy / carbon / thermodynamic context.

    Holds the (overridable) coefficient models and produces per-task results.
    Stateless with respect to accumulation — callers own a ThermoAccount.
    """

    def __init__(
        self,
        backends: Dict[str, BackendEnergy] = None,
        facility: FacilityModel = None,
        grid: GridModel = None,
        information: InformationModel = None,
        cache_wh_per_hit: float = 5.0e-5,
    ) -> None:
        self.backends = backends if backends is not None else default_backends()
        self.facility = facility if facility is not None else FacilityModel()
        self.grid = grid if grid is not None else GridModel()
        self.information = information if information is not None else InformationModel()
        # A cache hit is a key-value store read — negligible vs inference, but
        # not zero. Default ~5e-5 Wh; overridable.
        if cache_wh_per_hit < 0.0:
            raise ValueError("cache_wh_per_hit must be non-negative")
        self.cache_wh_per_hit = cache_wh_per_hit

    def account_inference(
        self, backend_id: str, total_tokens: int,
        output_tokens: int, success_score: float,
    ) -> EnergyCarbonResult:
        """Estimate the thermodynamic cost of one model inference."""
        if backend_id not in self.backends:
            raise KeyError(f"unknown backend '{backend_id}' — add it to the energy registry")
        if total_tokens < 0 or output_tokens < 0:
            raise ValueError("token counts must be non-negative")
        be = self.backends[backend_id]
        it_wh = (total_tokens / 1000.0) * be.wh_per_1k_tokens
        it_joules = it_wh * JOULES_PER_WH
        facility_joules = it_joules * self.facility.pue
        return EnergyCarbonResult(
            backend_id=backend_id,
            tokens=total_tokens,
            it_energy_joules=it_joules,
            facility_energy_joules=facility_joules,
            carbon_gco2e=self.grid.carbon_gco2e(facility_joules),
            useful_bits=self.information.useful_bits(output_tokens, success_score),
        )

    def account_cache_hit(self, output_tokens: int, success_score: float) -> EnergyCarbonResult:
        """Estimate the cost of serving a task from cache (a store lookup)."""
        it_joules = self.cache_wh_per_hit * JOULES_PER_WH
        facility_joules = it_joules * self.facility.pue
        return EnergyCarbonResult(
            backend_id="cache",
            tokens=0,
            it_energy_joules=it_joules,
            facility_energy_joules=facility_joules,
            carbon_gco2e=self.grid.carbon_gco2e(facility_joules),
            useful_bits=self.information.useful_bits(output_tokens, success_score),
        )


# ─── invariant verification (TA1-TA4) ───────────────────────────────────────
def verify_account(account: ThermoAccount, temperature_k: float = 300.0
                    ) -> List[Tuple[str, bool]]:
    """Return (invariant_name, holds) pairs. Used by tests and self-checks."""
    eff = account.thermodynamic_efficiency(temperature_k)
    checks: List[Tuple[str, bool]] = [
        ("TA3: energy non-negative", account.energy_joules >= 0.0),
        ("TA3: carbon non-negative", account.carbon_gco2e >= 0.0),
        ("TA3: useful_bits non-negative", account.useful_bits >= 0.0),
        ("TA4: efficiency within [0, 1]", 0.0 <= eff <= 1.0),
    ]
    if account.useful_bits > 0:
        floor = landauer_energy_per_bit(temperature_k)
        checks.append(
            ("TA4: energy-per-bit >= Landauer floor",
             account.joules_per_useful_bit >= floor))
        # per-bit and per-rate formulations agree at D = 1
        checks.append(
            ("consistency: landauer_ratio(D=1) == efficiency",
             math.isclose(account.landauer_ratio(temperature_k, 1.0), eff,
                          rel_tol=1e-9, abs_tol=1e-15)))
    return checks
